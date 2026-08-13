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
 * `recordAcceptedVersion` is intentionally UNCONDITIONAL (it does not
 * itself enforce "only advance forward"): a SIGNED_ROLLBACK acceptance
 * must be able to move this floor DOWN to its named target version (doc
 * 22 Section 4/Section 6) -- the caller (FamilyEnvelopeVerifier) is
 * responsible for only invoking this on full acceptance, having already
 * enforced ordinary monotonicity before ever reaching this call for a
 * POLICY_UPDATE.
 */
/** PCA-SYNC-DURABILITY-1: async, see ReplayLedger.ts's identical note. */
export interface DataVersionLedger {
  getLastAcceptedVersion(familyId: OpaqueFamilyId, senderKeyId: SenderKeyId): Promise<string | null>;
  recordAcceptedVersion(familyId: OpaqueFamilyId, senderKeyId: SenderKeyId, semanticVersion: string): Promise<void>;
}
