import type { FamilyTrustSetEpoch } from './types.js';

export interface FdekWrapTarget {
  deviceId: string;
  dekKeyId: string;
  dekPublicKey: string;
}

/**
 * PCA-SEC-019 (doc 09 Section 3.5): "every revocation MUST trigger an
 * FDEK rotation to every remaining trusted device." This function is the
 * protocol-neutral half of that contract: given the epoch that a
 * rotation (ordinary or recovery) just moved the family TO, it returns
 * exactly the DEKs that must receive the new FDEK -- every entry whose
 * status is ACTIVE, and nothing else. `REVOKED`, `DEVICE_OFFLINE`,
 * `EPOCH_STALE`, `ROTATION_PENDING`, and `RECOVERY_REQUIRED` entries are
 * all excluded: a revoked device must never receive the new key
 * (defeating the point of revoking it), and a non-ACTIVE-but-not-revoked
 * device does not currently hold a confirmed live channel to wrap a key
 * to -- it converges once it reconnects and adopts the new epoch (doc 09
 * Section 3.5: "no atomicity claim"), at which point a fresh call against
 * the epoch it actually lands on will include it.
 *
 * This module performs no wrapping/encryption itself (that requires the
 * concrete AEAD/KEM construction, WAITING_HUMAN_SECURITY_REVIEW) -- it
 * only fixes WHICH keys a caller's wrapping step must target, which is a
 * pure function of the accepted epoch and needs no cryptography to be
 * correct or testable.
 */
export function deviceKeysToWrapFdekFor(epoch: FamilyTrustSetEpoch): FdekWrapTarget[] {
  return epoch.entries
    .filter((entry) => entry.status === 'ACTIVE')
    .map((entry) => ({ deviceId: entry.deviceId, dekKeyId: entry.dekKeyId, dekPublicKey: entry.dekPublicKey }));
}
