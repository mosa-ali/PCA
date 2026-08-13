import type { OpaqueFamilyId, SenderKeyId } from './types.js';

/**
 * Per-(family, sender-key) record of the last ACCEPTED semanticVersion,
 * used ONLY for message types doc 22 Section 4 describes as strictly
 * increasing (currently: POLICY_UPDATE -- see
 * policy.ts's requiresStrictVersionIncrease). Most message types do NOT
 * use this ledger at all; their idempotency comes from
 * MessageIdempotencyLedger instead. As with ReplayLedger, only a
 * fully-accepted envelope's version may be recorded -- a rejected
 * envelope (bad signature, expired, etc.) must never move this state
 * forward.
 *
 * PCA-17C RUNTIME-SYNC-ACCEPTANCE-INTEGRITY: `familyId` is now a REQUIRED,
 * explicit parameter -- see ReplayLedger.ts's identical note on why this
 * MUST be the caller's authoritative, session-derived family identity, not
 * envelope.familyId.
 *
 * PCA-17E POLICY_VERSION_MULTI_INSTANCE_TOCTOU / SIGNED_ROLLBACK_SEPARATION:
 * the old single `recordAcceptedVersion` was intentionally UNCONDITIONAL
 * (last-write-wins) precisely so a SIGNED_ROLLBACK could move the floor
 * DOWN -- but that same unconditional setter also meant an ORDINARY
 * POLICY_UPDATE write could silently overwrite a newer floor a concurrent
 * backend instance had already committed (two instances both reading the
 * SAME stale floor, each individually valid against what THEY read, racing
 * to write). Splitting into two named operations closes that gap without
 * touching SIGNED_ROLLBACK's documented ability to move the floor down:
 *
 *  - `advancePolicyVersionIfNewer`: the ONLY write path for ordinary
 *    POLICY_UPDATE. Atomically, at write time (not against a value the
 *    caller merely read earlier), determines whether `candidateVersion` is
 *    strictly newer than whatever the CURRENT durable floor is -- which may
 *    have moved since the caller's own earlier `getLastAcceptedVersion`
 *    pre-check -- and only commits if so. Returns an explicit
 *    AdvancePolicyVersionResult so the caller can correctly reject a race
 *    LOSER (a candidate that was valid against a stale read but is now
 *    stale against the durable floor) rather than reporting it as applied.
 *  - `recordAuthorizedRollbackVersion`: the ONLY write path for
 *    SIGNED_ROLLBACK. Remains unconditional (doc 22 Section 6: "a rollback
 *    is a message type, not a relaxed monotonicity check") -- callable ONLY
 *    from the SIGNED_ROLLBACK acceptance path, never as a generic escape
 *    hatch for an ordinary update that failed the CAS.
 */
/** PCA-SYNC-DURABILITY-1: async, see ReplayLedger.ts's identical note. */
export type AdvancePolicyVersionResult = 'advanced' | 'stale';

export interface DataVersionLedger {
  getLastAcceptedVersion(familyId: OpaqueFamilyId, senderKeyId: SenderKeyId): Promise<string | null>;
  /**
   * Atomic compare-and-set: commits `candidateVersion` as the new floor
   * IF AND ONLY IF it is strictly newer (per policy.ts's
   * compareSemanticVersions) than whatever is durably stored for
   * (familyId, senderKeyId) at the moment of the write -- re-checked
   * against the LATEST committed value, not a value read earlier by this
   * caller. Returns 'advanced' on success, 'stale' if some concurrent
   * writer's already-committed floor is now >= candidateVersion.
   */
  advancePolicyVersionIfNewer(
    familyId: OpaqueFamilyId,
    senderKeyId: SenderKeyId,
    candidateVersion: string,
  ): Promise<AdvancePolicyVersionResult>;
  /**
   * Unconditional set, reserved for the SIGNED_ROLLBACK acceptance path --
   * see this interface's own doc comment above for why an ordinary
   * POLICY_UPDATE must never use this.
   */
  recordAuthorizedRollbackVersion(familyId: OpaqueFamilyId, senderKeyId: SenderKeyId, rollbackVersion: string): Promise<void>;
}
