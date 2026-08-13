import type { MessageId, OpaqueFamilyId } from './types.js';

/**
 * Per-(family, messageId) record of the canonical bytes of the envelope
 * that was fully ACCEPTED under that id (doc 22 Section 3: messageId is
 * "globally unique for idempotency," "stable across relay
 * retransmission"; Section 7's contract test: "valid signed policy
 * delivered twice -> exactly one application and stable receipt").
 *
 * PCA-17C RUNTIME-SYNC-ACCEPTANCE-INTEGRITY: `familyId` is now a REQUIRED,
 * explicit parameter -- see ReplayLedger.ts's identical note on why this
 * MUST be the caller's authoritative, session-derived family identity, not
 * envelope.familyId. Doc 22's "globally unique for idempotency" describes
 * messageId's intended WIRE-PROTOCOL contract for a well-behaved sender; it
 * is not a security property this ledger may rely on to key its acceptance
 * state, since a malicious or compromised sender's self-declared messageId
 * (and familyId) are both untrusted input. Scoping by the authoritative
 * familyId means a messageId collision across two different families -- an
 * accidental duplicate or a deliberately forged reuse attempt -- can never
 * share idempotency/conflict state.
 *
 * This is deliberately separate from ReplayLedger: ReplayLedger is a
 * SECURITY control (a captured-and-replayed old sequence/nonce must
 * never be re-applied, full stop). MessageIdempotencyLedger is an
 * APPLICATION-level exactly-once-effect guarantee -- a legitimate
 * at-least-once redelivery of the SAME already-accepted envelope (same
 * messageId, byte-identical canonical content) must succeed identically,
 * not be rejected as a replay.
 *
 * Only a fully-accepted envelope's canonical bytes may be recorded here
 * -- recording on any rejection path would let a forged or malformed
 * envelope poison a legitimate future messageId.
 */
/** PCA-SYNC-DURABILITY-1: async, see ReplayLedger.ts's identical note. */
export interface MessageIdempotencyLedger {
  /** Returns the canonical bytes previously accepted under this (familyId, messageId), or null if none. */
  getAcceptedCanonicalBytes(familyId: OpaqueFamilyId, messageId: MessageId): Promise<string | null>;
  /**
   * Records acceptance. Implementations MUST make this genuinely atomic
   * ACROSS CONCURRENT CALLERS/PROCESSES for a given (familyId, messageId):
   * if a conflicting canonicalBytes value is already durably recorded, this
   * must signal MESSAGE_ID_CONFLICT rather than silently overwriting it --
   * see MySqlMessageIdempotencyLedger's doc comment for the concrete
   * mechanism. A byte-identical redelivery is always a safe, silent no-op.
   */
  recordAccepted(familyId: OpaqueFamilyId, messageId: MessageId, canonicalBytes: string): Promise<RecordAcceptedResult>;
  /**
   * PCA-17E ACCEPTANCE-ORDERING: compensating undo for a row THIS SAME
   * CALLER just durably won with `recordAccepted` returning
   * `{ outcome: 'recorded' }` (never a row some OTHER caller won, and
   * never after an `'already-idempotent'` outcome, where nothing new was
   * written by this caller). Used only when a LATER step in the same
   * acceptance decision (the atomic replay claim, or the semantic-version
   * CAS) subsequently determines the envelope must, after all, be
   * rejected -- see FamilyEnvelopeVerifier.evaluateEnvelope's
   * acceptance-ordering doc comment for why: without this, a rejected
   * (e.g. REPLAYED) envelope's messageId would remain permanently recorded
   * as "accepted," so a future genuine retry of that exact messageId would
   * incorrectly short-circuit to a stable idempotent accept instead of
   * being re-evaluated and correctly rejected again.
   *
   * PCA-17F ATOMIC_ENVELOPE_ACCEPTANCE_RACE: on the production MySQL
   * acceptance path (evaluateEnvelope called with `options.atomicAcceptance`
   * set -- see EnvelopeAcceptanceTransaction.ts), this method is NEVER
   * called: MySqlEnvelopeAcceptanceTransaction commits message-id/replay/
   * version writes as one database transaction and lets ROLLBACK undo a
   * rejected candidate's message-id row atomically, so no separate
   * compensating DELETE is needed or invoked. This method remains callable
   * ONLY for the legacy saga fallback evaluateEnvelope uses when no atomic
   * transaction is supplied -- correct for in-memory, single-process
   * ledgers, never wired into production composition (src/main.ts).
   */
  releaseAccepted(familyId: OpaqueFamilyId, messageId: MessageId): Promise<void>;
}

export type RecordAcceptedResult = { outcome: 'recorded' } | { outcome: 'already-idempotent' } | { outcome: 'conflict' };
