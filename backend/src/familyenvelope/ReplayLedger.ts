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
export interface ReplayLedger {
  hasProcessed(familyId: OpaqueFamilyId, senderKeyId: SenderKeyId, sequenceOrNonce: string): Promise<boolean>;
  recordProcessed(familyId: OpaqueFamilyId, senderKeyId: SenderKeyId, sequenceOrNonce: string): Promise<void>;
}
