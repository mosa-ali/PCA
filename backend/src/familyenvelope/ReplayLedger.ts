import type { SenderKeyId } from './types.js';

/**
 * Per-sender-key record of already-processed sequence/nonce values (doc 09
 * PCA-SEC-021). "Processed" means ACCEPTED -- an envelope that was
 * rejected for any other reason (bad signature, expired, etc.) must never
 * be recorded here, or a legitimate retransmission of the same
 * sequence/nonce from the real sender would be permanently, incorrectly
 * blocked.
 */
export interface ReplayLedger {
  hasProcessed(senderKeyId: SenderKeyId, sequenceOrNonce: string): boolean;
  recordProcessed(senderKeyId: SenderKeyId, sequenceOrNonce: string): void;
}
