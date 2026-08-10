import type { SenderKeyId } from './types.js';

/**
 * Per-sender-key record of the last ACCEPTED policy/data version (doc 09
 * Section 4: "policy/data version, checked for strict monotonicity...
 * except for an explicitly signed rollback message type"). As with
 * ReplayLedger, only a fully-accepted envelope's version may be recorded
 * -- a rejected envelope (bad signature, expired, etc.) must never move
 * this state forward.
 */
export interface DataVersionLedger {
  getLastAcceptedVersion(senderKeyId: SenderKeyId): number | null;
  recordAcceptedVersion(senderKeyId: SenderKeyId, dataVersion: number): void;
}
