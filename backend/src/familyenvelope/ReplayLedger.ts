import type { OpaqueFamilyId, SenderKeyId } from './types.js';

/**
 * Per-(family, sender-key) record of already-processed sequence/nonce
 * values (doc 09 PCA-SEC-021). "Processed" means ACCEPTED -- an envelope
 * that was rejected for any other reason (bad signature, expired, etc.)
 * must never be recorded here, or a legitimate retransmission of the same
 * sequence/nonce from the real sender would be permanently, incorrectly
 * blocked.
 *
 * PCA-17C RUNTIME-SYNC-ACCEPTANCE-INTEGRITY: `familyId` is now a REQUIRED,
 * explicit parameter on every method -- previously this ledger was keyed
 * only by (senderKeyId, sequenceOrNonce), globally across every family.
 * `familyId` here MUST be the caller's AUTHORITATIVE, session-derived
 * family identity (see FamilyEnvelopeVerifier's EnvelopeAcceptanceContext.
 * familyId doc comment), never the envelope's own self-declared
 * `envelope.familyId` -- an envelope's self-declared familyId is untrusted
 * input a malicious or compromised sender could set to any value.
 */
/**
 * PCA-SYNC-DURABILITY-1: async (Promise-returning), not sync -- a durable
 * (survives-backend-restart) implementation must be able to reach a real
 * datastore, which is never synchronous in Node. InMemoryReplayLedger
 * still resolves synchronously in practice (no real I/O), but returns a
 * Promise like every other implementation so callers (FamilyEnvelopeVerifier,
 * SyncCoordinator) work identically against either backing store -- a
 * genuine drop-in replacement, not two divergent contracts.
 */
export type ClaimReplayResult = 'claimed' | 'already-claimed';

export interface ReplayLedger {
  hasProcessed(familyId: OpaqueFamilyId, senderKeyId: SenderKeyId, sequenceOrNonce: string): Promise<boolean>;
  recordProcessed(familyId: OpaqueFamilyId, senderKeyId: SenderKeyId, sequenceOrNonce: string): Promise<void>;
  /**
   * PCA-17E REPLAY_MULTI_INSTANCE_TOCTOU: the atomic, cross-process
   * check-and-set `hasProcessed` + `recordProcessed` never was. Two
   * different backend instances can both observe `hasProcessed === false`
   * for the SAME (familyId, senderKeyId, sequenceOrNonce) before either has
   * written anything -- e.g. two envelopes with the SAME sender+nonce but
   * DIFFERENT messageIds, each independently signature-valid, racing
   * concurrently. `claimProcessed` is the authoritative, atomic decision:
   * implementations MUST make it genuinely atomic ACROSS CONCURRENT
   * CALLERS/PROCESSES for a given (familyId, senderKeyId, sequenceOrNonce)
   * -- exactly one concurrent caller may ever observe 'claimed' for a given
   * key; every other concurrent caller (whatever envelope/messageId it is
   * acting on behalf of) must observe 'already-claimed' and treat its
   * envelope as REPLAYED. See MySqlReplayLedger's doc comment for the
   * concrete mechanism (a plain INSERT against the same unique key
   * `hasProcessed`/`recordProcessed` already rely on, leaning on InnoDB's
   * unique-index enforcement as the actual cross-process arbiter, not an
   * in-process mutex). `hasProcessed` remains a cheap, non-authoritative
   * pre-check callers may still use to fail fast before expensive work
   * (e.g. signature verification) -- only `claimProcessed`'s result may
   * gate actual acceptance.
   */
  claimProcessed(familyId: OpaqueFamilyId, senderKeyId: SenderKeyId, sequenceOrNonce: string): Promise<ClaimReplayResult>;
  /**
   * Compensating undo for a claim THIS SAME CALLER just won via
   * `claimProcessed` (never anyone else's claim), used only when a LATER
   * step in the same acceptance decision (e.g. the semantic-version CAS)
   * subsequently determines the envelope must, after all, be rejected --
   * see FamilyEnvelopeVerifier.evaluateEnvelope's acceptance-ordering doc
   * comment. Releasing a claim that was never truly ours to release would
   * be a correctness bug (undoing a DIFFERENT caller's legitimate claim),
   * so this must only ever be invoked on a key this exact call just won.
   */
  releaseClaim(familyId: OpaqueFamilyId, senderKeyId: SenderKeyId, sequenceOrNonce: string): Promise<void>;
}
