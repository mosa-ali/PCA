import { canonicalizeTrustSetEpoch } from './canonicalize.js';
import { activeOwnerCount, findActiveOwner, findDuplicateIdentity } from './FamilyTrustSetEngine.js';
import { isDistinctKeyPair } from './policy.js';
import type { RecoveryTransactionLedger } from './RecoveryTransactionLedger.js';
import type { FamilyTrustSetStore } from './FamilyTrustSetStore.js';
import type { TrustSetSignatureVerifier } from './TrustSetSignatureVerifier.js';
import type { OpenedRecoveryEnvelope } from '../recovery/RecoveryEnvelopeCipher.js';
import type { FamilyTrustSetEntry, FamilyTrustSetEpoch } from './types.js';

export type RecoveryFtsRejectionReason =
  | 'NO_ESTABLISHED_FAMILY'
  | 'FAMILY_MISMATCH'
  | 'ENVELOPE_EPOCH_MISMATCH'
  | 'NOT_EXACTLY_ONE_ACTIVE_OWNER'
  | 'KEYS_NOT_DISTINCT'
  | 'DUPLICATE_ENTRY_IDENTITY'
  | 'TRUST_SET_EPOCH_NOT_ADVANCED'
  | 'KEY_EPOCH_NOT_ADVANCED'
  | 'PRIOR_DEVICE_SILENTLY_DROPPED'
  | 'NO_PRIOR_DEVICE_REVOKED'
  | 'NEW_OWNER_KEYS_NOT_DISTINCT_FROM_PRIOR'
  | 'RECOVERY_TRANSACTION_ALREADY_USED'
  | 'INVALID_SIGNATURE'
  | 'CONCURRENT_EPOCH_CHANGED';

export type RecoveryFtsVerdict =
  | { accepted: true }
  | { accepted: false; reason: RecoveryFtsRejectionReason };

/**
 * The dedicated recovery-authorized FTS epoch acceptance path (doc 09
 * Section 10 / doc 21 Section 5) that closes the
 * FTS_RECOVERY_ACCEPTANCE = PENDING_RECOVERY_WORKSTREAM gap left in
 * FamilyTrustSetEngine.ts. This is intentionally a SEPARATE function, not
 * a branch inside acceptEpoch:
 *
 *   - acceptEpoch's authorized signer is always the PREVIOUS epoch's
 *     stored ACTIVE OWNER DSK (or, at genesis, the candidate's own
 *     claimed owner). It has no path that lets a brand-new, previously
 *     unknown DSK self-certify against an ALREADY-ESTABLISHED family --
 *     doing so would mean anyone who can submit a candidate epoch could
 *     silently self-appoint as owner.
 *   - acceptRecoveryEpoch is the ONLY function that allows a new epoch's
 *     own claimed OWNER to self-certify against an established family,
 *     and it does so ONLY when the caller supplies an
 *     OpenedRecoveryEnvelope -- a value producible only by a real
 *     RecoveryEnvelopeCipher.open() success (see that module) -- bound to
 *     the same family and a one-time recoveryTransactionId that this
 *     function atomically claims before ever mutating the store.
 *
 * Because these are two different exported functions with two different
 * signatures (this one REQUIRES an OpenedRecoveryEnvelope; acceptEpoch
 * has no such parameter at all), a caller cannot reach recovery-grade
 * authorization by accident through the ordinary call -- the compiler
 * would reject a call to acceptEpoch that tried to pass recovery proof,
 * and a call to acceptRecoveryEpoch without one is a type error, not a
 * runtime bypass.
 */
export async function acceptRecoveryEpoch(
  epoch: FamilyTrustSetEpoch,
  opened: OpenedRecoveryEnvelope,
  store: FamilyTrustSetStore,
  verifier: TrustSetSignatureVerifier,
  ledger: RecoveryTransactionLedger,
): Promise<RecoveryFtsVerdict> {
  // Recovery is a controlled trust TRANSITION for an already-established
  // family (doc 09 Section 10's opening line: "Recovery is a controlled
  // trust transition, not a support reset"). A family with no prior epoch
  // has nothing to recover FROM -- that is genesis, acceptEpoch's job.
  const currentEpoch = store.getCurrentEpoch();
  if (!currentEpoch) {
    return { accepted: false, reason: 'NO_ESTABLISHED_FAMILY' };
  }
  if (opened.familyId !== currentEpoch.familyId || opened.familyId !== epoch.familyId) {
    return { accepted: false, reason: 'FAMILY_MISMATCH' };
  }
  // The envelope's own recorded binding (doc 09 Section 3.4's associated
  // data: "familyId, envelope ID, epochs, suite IDs") must not claim
  // knowledge of an epoch this device has never reached -- an envelope
  // bound to a FUTURE epoch relative to this device's own current state
  // cannot be genuine (this device IS the source of truth for "current").
  if (opened.boundTrustSetEpoch > currentEpoch.trustSetEpoch || opened.boundKeyEpoch > currentEpoch.keyEpoch) {
    return { accepted: false, reason: 'ENVELOPE_EPOCH_MISMATCH' };
  }

  if (activeOwnerCount(epoch.entries) !== 1) {
    return { accepted: false, reason: 'NOT_EXACTLY_ONE_ACTIVE_OWNER' };
  }
  for (const entry of epoch.entries) {
    if (!isDistinctKeyPair(entry.dskPublicKey, entry.dekPublicKey)) {
      return { accepted: false, reason: 'KEYS_NOT_DISTINCT' };
    }
  }

  // The replacement parent's fresh keys (doc 09 Section 10: "generates
  // new DSK/DEK pairs") must be genuinely new -- never a previously-
  // trusted key resurrected under recovery authority, which would let a
  // supposedly-revoked identity effectively un-revoke itself. Checked
  // BEFORE findDuplicateIdentity below on purpose: every prior device
  // must be explicitly carried forward in the candidate epoch (the
  // PRIOR_DEVICE_SILENTLY_DROPPED check further down), so any reuse of a
  // prior key would ALSO trip findDuplicateIdentity's cross-entry
  // uniqueness check -- but that would only ever report the less specific
  // DUPLICATE_ENTRY_IDENTITY, obscuring that the real defect is key
  // resurrection specifically. Ordered first so this attack gets its own
  // precise, testable rejection reason.
  const newOwner = findActiveOwner(epoch);
  if (!newOwner) {
    // Unreachable given the activeOwnerCount check above, but keeps this
    // function's control flow total rather than asserting non-null.
    return { accepted: false, reason: 'NOT_EXACTLY_ONE_ACTIVE_OWNER' };
  }
  const priorKeys = collectAllKeys(currentEpoch.entries);
  if (priorKeys.has(newOwner.dskPublicKey) || priorKeys.has(newOwner.dekPublicKey)) {
    return { accepted: false, reason: 'NEW_OWNER_KEYS_NOT_DISTINCT_FROM_PRIOR' };
  }

  if (findDuplicateIdentity(epoch.entries)) {
    return { accepted: false, reason: 'DUPLICATE_ENTRY_IDENTITY' };
  }

  // Recovery moves the family FORWARD, strictly, on both axes -- unlike
  // acceptEpoch's ordinary path (which allows keyEpoch to stay equal for
  // a metadata-only change), a recovery transaction always represents a
  // key compromise/loss scenario, so PCA-SEC-019 ("every revocation MUST
  // trigger an FDEK rotation") applies unconditionally here: keyEpoch
  // MUST strictly increase, not merely not-decrease.
  if (epoch.trustSetEpoch <= currentEpoch.trustSetEpoch) {
    return { accepted: false, reason: 'TRUST_SET_EPOCH_NOT_ADVANCED' };
  }
  if (epoch.keyEpoch <= currentEpoch.keyEpoch) {
    return { accepted: false, reason: 'KEY_EPOCH_NOT_ADVANCED' };
  }

  const newEntriesByDeviceId = new Map(epoch.entries.map((entry) => [entry.deviceId, entry]));
  let priorDeviceNewlyRevoked = false;
  for (const priorEntry of currentEpoch.entries) {
    const carriedForward = newEntriesByDeviceId.get(priorEntry.deviceId);
    // Every device that existed before recovery must be explicitly
    // carried forward (with an explicit status) in the recovery epoch --
    // never silently dropped. Losing a row would lose the audit trail of
    // what recovery actually did to that identity, and would make it
    // impossible to tell "revoked by this recovery" apart from "just
    // never mentioned."
    if (!carriedForward) {
      return { accepted: false, reason: 'PRIOR_DEVICE_SILENTLY_DROPPED' };
    }
    if (priorEntry.status !== 'REVOKED' && carriedForward.status === 'REVOKED') {
      priorDeviceNewlyRevoked = true;
    }
  }
  // A recovery transaction that revokes nothing isn't recovering from a
  // loss -- it is indistinguishable from someone using recovery-grade
  // authorization to make an ordinary change, which is exactly the
  // "cannot use the ordinary owner path by accident" boundary this
  // engine exists to hold in the OTHER direction too: recovery authority
  // must not be usable as a stronger substitute for the ordinary path
  // when there is nothing to recover.
  if (!priorDeviceNewlyRevoked) {
    return { accepted: false, reason: 'NO_PRIOR_DEVICE_REVOKED' };
  }

  // Signature check: the recovery epoch is signed by its OWN claimed new
  // owner (trust-on-first-use for the REPLACEMENT identity, authorized by
  // everything already verified above -- the opened envelope's family/
  // epoch binding plus the one-time transaction claim below -- never by
  // the previous epoch's now-potentially-compromised OWNER DSK).
  const canonicalBytes = canonicalizeTrustSetEpoch(epoch);
  const validSignature = await verifier.verify(newOwner.dskPublicKey, canonicalBytes, epoch.signature);
  if (!validSignature) {
    return { accepted: false, reason: 'INVALID_SIGNATURE' };
  }

  // Claim the one-time transaction ID LAST among the "would this request
  // otherwise succeed" checks, and strictly before the store write: a
  // request that fails any check above never touches the ledger (no
  // burn-on-attempt), while a request that passes every other check still
  // cannot double-spend the same recoveryTransactionId, including against
  // a concurrent identical request racing this one (see
  // RecoveryTransactionLedger's atomicity contract).
  const claimed = await ledger.claimTransaction(opened.recoveryTransactionId);
  if (!claimed) {
    return { accepted: false, reason: 'RECOVERY_TRANSACTION_ALREADY_USED' };
  }

  // Optimistic-concurrency re-check: re-read the store immediately before
  // writing and compare it to the snapshot every check above validated
  // against. Two different (or even identical) recovery attempts can
  // interleave across this function's `await` points; without this check,
  // both could pass validation against the same stale `currentEpoch` and
  // both write, producing a split-brain "two owners" outcome despite each
  // individually satisfying every check above. The transaction id stays
  // permanently claimed either way (per RecoveryTransactionLedger's
  // contract) -- losing this race does not entitle a retry with the same
  // id, since the recovery this specific proposal represented is now moot.
  const stillCurrent = store.getCurrentEpoch();
  if (
    stillCurrent?.trustSetEpoch !== currentEpoch.trustSetEpoch ||
    stillCurrent?.keyEpoch !== currentEpoch.keyEpoch ||
    stillCurrent?.signature !== currentEpoch.signature
  ) {
    return { accepted: false, reason: 'CONCURRENT_EPOCH_CHANGED' };
  }

  store.setCurrentEpoch(epoch);
  return { accepted: true };
}

function collectAllKeys(entries: FamilyTrustSetEntry[]): Set<string> {
  const keys = new Set<string>();
  for (const entry of entries) {
    keys.add(entry.dskPublicKey);
    keys.add(entry.dekPublicKey);
  }
  return keys;
}
