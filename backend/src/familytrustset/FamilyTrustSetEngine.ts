import { canonicalizeTrustSetEpoch } from './canonicalize.js';
import { isDistinctKeyPair } from './policy.js';
import type { FamilyTrustSetStore } from './FamilyTrustSetStore.js';
import type { TrustSetSignatureVerifier } from './TrustSetSignatureVerifier.js';
import type { FamilyTrustSetEntry, FamilyTrustSetEpoch } from './types.js';

export type FtsRejectionReason =
  | 'NOT_EXACTLY_ONE_ACTIVE_OWNER'
  | 'KEYS_NOT_DISTINCT'
  | 'FAMILY_MISMATCH'
  | 'STALE_EPOCH'
  | 'INVALID_SIGNATURE';

export type FtsVerdict = { accepted: true } | { accepted: false; reason: FtsRejectionReason };

function activeOwnerCount(entries: FamilyTrustSetEntry[]): number {
  return entries.filter((entry) => entry.role === 'OWNER' && entry.status === 'ACTIVE').length;
}

function findActiveOwner(epoch: FamilyTrustSetEpoch): FamilyTrustSetEntry | null {
  return epoch.entries.find((entry) => entry.role === 'OWNER' && entry.status === 'ACTIVE') ?? null;
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
 *   2. Every entry's DSK and DEK must be distinct key material.
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
