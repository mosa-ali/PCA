import type { FamilyEnvelopeMessageType, MessageId, OpaqueFamilyId, SenderKeyId } from './types.js';

/**
 * PCA-17F ATOMIC ACCEPTANCE: the input to a single, all-or-nothing
 * acceptance decision covering every ledger-mutating side effect of
 * FamilyEnvelopeVerifier.evaluateEnvelope's accept path -- message-id
 * idempotency arbitration, the replay claim, and (for POLICY_UPDATE /
 * SIGNED_ROLLBACK) the semantic-version write. Every field here is already
 * validated/canonicalized by the time evaluateEnvelope reaches its
 * accept-side-effects step (signature verified, family checked, etc.) --
 * this boundary performs no further business-rule validation itself, only
 * atomic arbitration/persistence.
 */
export interface EnvelopeAcceptanceCommitInput {
  familyId: OpaqueFamilyId;
  messageId: MessageId;
  canonicalBytes: string;
  senderKeyId: SenderKeyId;
  sequenceOrNonce: string;
  messageType: FamilyEnvelopeMessageType;
  semanticVersion: string;
}

export type EnvelopeAcceptanceCommitResult =
  | { outcome: 'accepted'; idempotent: boolean }
  | { outcome: 'rejected'; reason: 'MESSAGE_ID_CONFLICT' | 'REPLAYED' | 'VERSION_NOT_MONOTONIC' };

/**
 * PCA-17F ATOMIC_ENVELOPE_ACCEPTANCE_RACE: closes the defect PCA-17E left
 * open -- MessageIdempotencyLedger's contract says a row represents a FULLY
 * ACCEPTED envelope, but the PCA-17E acceptance-ordering saga
 * (messageIdempotencyLedger.recordAccepted, each COMMITTING on its own,
 * followed by replayLedger.claimProcessed, then
 * versionLedger.advancePolicyVersionIfNewer, with compensating DELETEs on a
 * later step's rejection) makes the message-id row externally VISIBLE the
 * moment step 1 commits -- before replay/version have been decided. A
 * concurrent byte-identical redelivery landing in that window could observe
 * `{ accepted: true, idempotent: true }` for an envelope the original
 * caller goes on to reject (REPLAYED / VERSION_NOT_MONOTONIC) and
 * compensates away moments later.
 *
 * Required invariant: VISIBLE_IDEMPOTENCY_ACCEPTED IFF
 * FULL_ACCEPTANCE_TRANSACTION_COMMITTED -- a durable "accepted" record must
 * become externally visible ONLY once the envelope's complete
 * post-signature acceptance decision (message-id + replay + version, all
 * three) has committed. Implementations MUST run every mutating step of a
 * single `commitAcceptance` call inside ONE database transaction: COMMIT
 * only on final acceptance, ROLLBACK (undoing every write this call made,
 * including the message-id row) the instant any step determines the
 * envelope must be rejected. No compensating DELETE is used or needed --
 * ROLLBACK IS the compensation, and it is atomic with the write it undoes
 * by construction, eliminating the externally-visible intermediate state a
 * saga of independently-committing steps could otherwise expose.
 *
 * `evaluateEnvelope` calls this exactly once per (non-dry-run, non-cached)
 * acceptance decision, only after signature verification and every
 * cheap/early rejection check has already passed -- see
 * FamilyEnvelopeVerifier.ts's own doc comment on where this sits in the
 * pipeline. When no implementation is supplied, evaluateEnvelope falls back
 * to the legacy PCA-17E saga (three independently atomic per-ledger calls
 * plus compensating deletes) -- this fallback exists ONLY for in-memory,
 * single-process test ledgers, where there is no cross-process visibility
 * window to close in the first place (see FamilyEnvelopeVerifier.ts). The
 * production MySQL path always supplies MySqlEnvelopeAcceptanceTransaction.
 */
export interface EnvelopeAcceptanceTransaction {
  commitAcceptance(input: EnvelopeAcceptanceCommitInput): Promise<EnvelopeAcceptanceCommitResult>;
}
