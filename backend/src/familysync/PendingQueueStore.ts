import type { MessageId, OpaqueFamilyId, SenderKeyId } from '../familyenvelope/types.js';
import type { PendingEnvelopeRecord } from './types.js';

/**
 * Storage port for held envelopes. Bounding/eviction policy lives in the
 * implementation (see InMemoryPendingQueueStore); this interface only
 * fixes the shape a future persistent (survives-restart) implementation
 * must also satisfy.
 */
export interface PendingQueueStore {
  get(familyId: OpaqueFamilyId, messageId: MessageId): PendingEnvelopeRecord | null;
  listForFamily(familyId: OpaqueFamilyId): PendingEnvelopeRecord[];
  listForSender(familyId: OpaqueFamilyId, senderKeyId: SenderKeyId): PendingEnvelopeRecord[];
  countForFamily(familyId: OpaqueFamilyId): number;
  countForSender(familyId: OpaqueFamilyId, senderKeyId: SenderKeyId): number;
  countGlobal(): number;
  /** Returns false (fail-closed, no insert) if any bound would be exceeded -- see the class doc for why this never evicts someone else's existing entry to make room. */
  insert(record: PendingEnvelopeRecord): boolean;
  remove(familyId: OpaqueFamilyId, messageId: MessageId): void;
  /** All currently-stored records whose effectiveExpiresAt has passed as of `nowUtc`, across every family -- used by the coordinator's expiry sweep. */
  listExpired(nowUtc: Date): PendingEnvelopeRecord[];
}
