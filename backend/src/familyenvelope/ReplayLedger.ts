import type { SenderKeyId } from './types.js';

/**
 * Per-sender-key record of already-processed sequence/nonce values (doc 09
 * PCA-SEC-021). "Processed" means ACCEPTED -- an envelope that was
 * rejected for any other reason (bad signature, expired, etc.) must never
 * be recorded here, or a legitimate retransmission of the same
 * sequence/nonce from the real sender would be permanently, incorrectly
 * blocked.
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
  hasProcessed(senderKeyId: SenderKeyId, sequenceOrNonce: string): Promise<boolean>;
  recordProcessed(senderKeyId: SenderKeyId, sequenceOrNonce: string): Promise<void>;
}
