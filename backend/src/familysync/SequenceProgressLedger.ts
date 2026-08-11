import type { OpaqueFamilyId, SenderKeyId } from '../familyenvelope/types.js';

/**
 * Tracks the highest numeric sequence APPLIED (not merely seen -- see
 * ReplayLedger, a different concept) per (familyId, senderKeyId), for
 * senders the caller has opted into numeric-sequence gap detection
 * (see policy.ts's parseNumericSequence). This is new PCA-11-owned state;
 * it does not exist in src/familyenvelope, which only tracks "has this
 * exact sequenceOrNonce string been processed," not "what is the last
 * consecutive applied number."
 */
export interface SequenceProgressLedger {
  getLastAppliedSequence(familyId: OpaqueFamilyId, senderKeyId: SenderKeyId): number | null;
  recordAppliedSequence(familyId: OpaqueFamilyId, senderKeyId: SenderKeyId, sequence: number): void;
}
