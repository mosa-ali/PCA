import { canonicalizeTrustSetEpoch } from './canonicalize.js';
import { isDistinctKeyPair } from './policy.js';
import type { FamilyTrustSetStore } from './FamilyTrustSetStore.js';
import type { TrustSetSignatureVerifier } from './TrustSetSignatureVerifier.js';
import type { FamilyTrustSetEntry, FamilyTrustSetEpoch } from './types.js';

export type FtsRejectionReason =
  | 'NOT_EXACTLY_ONE_ACTIVE_OWNER'
  | 'KEYS_NOT_DISTINCT'
  | 'DUPLICATE_ENTRY_IDENTITY'
  | 'FAMILY_MISMATCH'
  | 'STALE_EPOCH'
  | 'STALE_KEY_EPOCH'
  | 'INVALID_SIGNATURE';

export type FtsVerdict = { accepted: true } | { accepted: false; reason: FtsRejectionReason };

/**
 * This engine implements the ORDINARY path: the previous epoch's ACTIVE
 * OWNER DSK signs the next epoch (or, at genesis, the candidate's own
 * claimed OWNER self-certifies). Doc 09 Section 10's recovery transaction
 * -- a DIFFERENT, recovery-authorized acceptance path for replacing a
 * lost/compromised owner, gated on a successfully-opened recovery
 * envelope rather than the previous epoch's OWNER signature -- is
 * implemented separately in FamilyTrustSetRecoveryEngine.ts, on purpose:
 * keeping it a structurally distinct function (not a branch inside
 * acceptEpoch) is what makes "a recovery authorization cannot use the
 * ordinary owner path by accident" true by construction, not just by
 * convention. A recovery-signed epoch presented to THIS function's
 * acceptEpoch still correctly fails the ordinary INVALID_SIGNATURE check
 * (its signer is never the previous epoch's stored OWNER) -- the two
 * paths cannot be confused for one another in either direction.
 */
export const FTS_RECOVERY_ACCEPTANCE = 'IMPLEMENTED_VIA_FamilyTrustSetRecoveryEngine';

export function activeOwnerCount(entries: FamilyTrustSetEntry[]): number {
  return entries.filter((entry) => entry.role === 'OWNER' && entry.status === 'ACTIVE').length;
}

export function findActiveOwner(epoch: FamilyTrustSetEpoch): FamilyTrustSetEntry | null {
  return epoch.entries.find((entry) => entry.role === 'OWNER' && entry.status === 'ACTIVE') ?? null;
}

/**
 * No public key or opaque device/key id may represent more than one
 * entry within the same epoch -- a single DSK/DEK silently standing in
 * for two device identities (or one device identity claimed by two
 * entries) would be a weaker trust model than doc 09's per-device DSK/DEK
 * role separation intends, even if every individual entry is otherwise
 * well-formed.
 */
export function findDuplicateIdentity(entries: FamilyTrustSetEntry[]): boolean {
  const deviceIds = new Set<string>();
  const dskKeyIds = new Set<string>();
  const dekKeyIds = new Set<string>();
  const dskPublicKeys = new Set<string>();
  const dekPublicKeys = new Set<string>();
  for (const entry of entries) {
    if (deviceIds.has(entry.deviceId)) return true;
    if (dskKeyIds.has(entry.dskKeyId)) return true;
    if (dekKeyIds.has(entry.dekKeyId)) return true;
    if (dskPublicKeys.has(entry.dskPublicKey)) return true;
    if (dekPublicKeys.has(entry.dekPublicKey)) return true;
    // A DSK and a DEK live in the same "key material" space here too --
    // isDistinctKeyPair already rejects one entry's own DSK==DEK, but an
    // entry's DSK must also never equal ANOTHER entry's DEK (or vice
    // versa), which would let one physical key masquerade in both roles
    // across two claimed identities.
    if (dekPublicKeys.has(entry.dskPublicKey) || dskPublicKeys.has(entry.dekPublicKey)) return true;
    deviceIds.add(entry.deviceId);
    dskKeyIds.add(entry.dskKeyId);
    dekKeyIds.add(entry.dekKeyId);
    dskPublicKeys.add(entry.dskPublicKey);
    dekPublicKeys.add(entry.dekPublicKey);
  }
  return false;
}

/**
 * Assumes `epoch` already passed structural validation (see
 * parseFamilyTrustSetEpoch) -- this function performs only the semantic
 * acceptance checks.
 *
 * Acceptance criteria, all independently checked (mirroring
 * FamilyEnvelopeVerifier's PCA-SEC-022 discipline even though the FTS
 * doc section doesn't use that exact label):
 *   1. PCA-FR-002A: the CANDIDATE epoch must contain exactly one
 *      ACTIVE OWNER entry -- a family trust set with zero or multiple
 *      active owners is never acceptable, regardless of signature.
 *   2. Every entry's DSK and DEK must be distinct key material (own-entry
 *      check), AND no deviceId/DSK key id/DEK key id/DSK public key/DEK
 *      public key may be reused across two different entries in the same
 *      epoch (cross-entry uniqueness -- see findDuplicateIdentity). No
 *      single public key may silently represent multiple device
 *      identities or roles.
 *   2.5. keyEpoch must never DECREASE relative to the store's current
 *      epoch (if any) -- independent of trustSetEpoch's own check below.
 *      Equal keyEpoch is allowed (a trust-set-metadata-only change need
 *      not itself rotate FDEK material); only a decrease is rejected.
 *   3. trustSetEpoch must be strictly greater than the store's current
 *      epoch (if any) -- this is NOT required to be exactly current+1.
 *      Doc 09 Section 3.5/PCA-SEC-020 explicitly describes only the
 *      single-step "device adopts N+1 at reconnect" case; it does not
 *      say whether a device that missed several rotations may adopt the
 *      latest epoch directly, or must walk each intermediate one. This
 *      module's own INTERPRETATION -- not something the doc mandates --
 *      is to allow the direct jump, since it fails safe either way (see
 *      the LIMITATION below): a skip spanning an ownership change is
 *      rejected (INVALID_SIGNATURE), never silently misauthorized.
 *      LIMITATION: signer resolution (below) only ever checks the
 *      STORED current epoch's owner, not a transitive chain through any
 *      skipped epochs. A multi-epoch jump verifies correctly whenever the
 *      OWNER role did not change across the gap (the same DSK signed
 *      both the device's last-known epoch and the new one). A gap that
 *      also includes an ownership transfer requires either delivering
 *      the full intermediate epoch chain (so each hop's signer can be
 *      verified against its own immediate predecessor) or a dedicated
 *      recovery/catch-up mechanism -- neither is built by this slice.
 *   4. The epoch must be signed by the AUTHORIZED signer: the previous
 *      (currently stored) epoch's ACTIVE OWNER DSK, or -- only when no
 *      epoch is stored yet (genesis) -- the candidate epoch's own claimed
 *      OWNER DSK (trust-on-first-use, doc 09 Section 3.3: the Owner
 *      device is the one generating the family's initial keys).
 *
 * The store is updated ONLY on full acceptance -- a rejected epoch, for
 * any reason, must never become the device's current trust set.
 */
export async function acceptEpoch(
  epoch: FamilyTrustSetEpoch,
  store: FamilyTrustSetStore,
  verifier: TrustSetSignatureVerifier,
): Promise<FtsVerdict> {
  if (activeOwnerCount(epoch.entries) !== 1) {
    return { accepted: false, reason: 'NOT_EXACTLY_ONE_ACTIVE_OWNER' };
  }
  for (const entry of epoch.entries) {
    if (!isDistinctKeyPair(entry.dskPublicKey, entry.dekPublicKey)) {
      return { accepted: false, reason: 'KEYS_NOT_DISTINCT' };
    }
  }
  if (findDuplicateIdentity(epoch.entries)) {
    return { accepted: false, reason: 'DUPLICATE_ENTRY_IDENTITY' };
  }

  const currentEpoch = store.getCurrentEpoch();
  // Defense-in-depth: this engine's contract is one store per family, so
  // this should never legitimately fire -- but a caller that ever shares
  // one store across families, or a corrupted/misrouted candidate, must
  // not be able to silently overwrite an unrelated family's trust set
  // just because it happens to carry a higher trustSetEpoch number.
  if (currentEpoch && epoch.familyId !== currentEpoch.familyId) {
    return { accepted: false, reason: 'FAMILY_MISMATCH' };
  }
  if (currentEpoch && epoch.trustSetEpoch <= currentEpoch.trustSetEpoch) {
    return { accepted: false, reason: 'STALE_EPOCH' };
  }
  // Anti-downgrade for FDEK material (doc 09 Section 3.5/PCA-SEC-019):
  // keyEpoch may stay EQUAL to the current one (a trust-set-metadata-only
  // change need not itself rotate FDEK material) or increase, but must
  // never DECREASE -- a lower keyEpoch would mean accepting a trust set
  // that claims an already-superseded, potentially-compromised key
  // generation is current, independent of whether trustSetEpoch itself
  // advanced.
  if (currentEpoch && epoch.keyEpoch < currentEpoch.keyEpoch) {
    return { accepted: false, reason: 'STALE_KEY_EPOCH' };
  }

  const authorizedSigner = currentEpoch ? findActiveOwner(currentEpoch) : findActiveOwner(epoch);
  // Both branches are guaranteed non-null here: currentEpoch (if present)
  // was itself only ever stored after passing this same check, and the
  // genesis branch's candidate already passed the exactly-one-active-owner
  // check above.
  const canonicalBytes = canonicalizeTrustSetEpoch(epoch);
  const validSignature = authorizedSigner
    ? await verifier.verify(authorizedSigner.dskPublicKey, canonicalBytes, epoch.signature)
    : false;
  if (!validSignature) {
    return { accepted: false, reason: 'INVALID_SIGNATURE' };
  }

  store.setCurrentEpoch(epoch);
  return { accepted: true };
}
