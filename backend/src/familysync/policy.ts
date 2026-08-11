/**
 * Bounded-queue defense ceilings (PCA-11 "bounded pending queue"). These
 * are resource-abuse ceilings, not security controls on their own --
 * mirrors src/familyenvelope/policy.ts's REPLAY_LEDGER_CAPACITY_PER_SENDER
 * rationale.
 */
export const MAX_PENDING_PER_SENDER = 64;
export const MAX_PENDING_PER_FAMILY = 256;
export const MAX_PENDING_GLOBAL = 4096;

/**
 * Independent of, and normally tighter than, whatever `expiresAt` an
 * individual envelope declares -- see PendingEnvelopeRecord.effectiveExpiresAt.
 */
export const MAX_PENDING_LIFETIME_MS = 24 * 60 * 60 * 1000;

const NUMERIC_SEQUENCE_SHAPE = /^(0|[1-9][0-9]{0,14})$/; // bounded so it always fits a JS safe integer

/**
 * Interprets `sequenceOrNonce` as an adjacency-orderable integer ONLY when
 * it is a plain, bounded-length decimal digit string. This is the
 * "narrow, wire-contract-compliant dependency signal" the PCA-11 brief
 * asks for (doc 22 Section 3 already allows a sender to use "a monotonic
 * sequence number" for this field) -- no new envelope field is invented.
 *
 * LIMITATION (documented, not silently papered over): a sender using an
 * opaque replayNonce instead could, by coincidence, produce an
 * all-digits string that this function also parses as numeric. That is
 * FAIL-SAFE, never fail-unsafe: gap detection only ever produces an
 * extra, unnecessary HOLD_PENDING (resolved by that same message's own
 * expiry) -- it can never cause an envelope to skip the full security
 * pipeline or be misapplied out of order, because every promoted pending
 * item is still re-run through evaluateEnvelope's complete signature/
 * replay/epoch/expiry checks at drain time. To avoid that false-positive
 * hold entirely, callers should only enable gap detection for senders they
 * know use numeric sequence mode (see SyncCoordinatorOptions.isNumericSequenceSender)
 * -- an opaque-nonce sender is simply never gap-checked when the caller's
 * predicate returns false for it, which is the recommended default.
 */
export function parseNumericSequence(sequenceOrNonce: string): number | null {
  if (!NUMERIC_SEQUENCE_SHAPE.test(sequenceOrNonce)) return null;
  const value = Number(sequenceOrNonce);
  return Number.isSafeInteger(value) ? value : null;
}

/**
 * doc 22 Section 3 lists CHILD_REQUEST/PARENT_DECISION correlation and
 * (per this PCA-11 brief) RETENTION_DELETION_INSTRUCTION/RETENTION_RECEIPT
 * as needing dependency ordering. Both already carry the accepted,
 * existing `correlationId` field -- this policy only decides WHICH message
 * types the coordinator holds pending on an unresolved correlationId; it
 * invents no new wire shape.
 */
const CORRELATION_DEPENDENT_MESSAGE_TYPES = new Set(['PARENT_DECISION', 'RETENTION_RECEIPT']);

export function requiresCorrelationPredecessor(messageType: string): boolean {
  return CORRELATION_DEPENDENT_MESSAGE_TYPES.has(messageType);
}
