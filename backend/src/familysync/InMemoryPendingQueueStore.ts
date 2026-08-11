import type { MessageId, OpaqueFamilyId, SenderKeyId } from '../familyenvelope/types.js';
import { MAX_PENDING_GLOBAL, MAX_PENDING_PER_FAMILY, MAX_PENDING_PER_SENDER } from './policy.js';
import type { PendingQueueStore } from './PendingQueueStore.js';
import type { PendingEnvelopeRecord } from './types.js';

/**
 * Bounded, in-memory reference PendingQueueStore. "Eviction must fail
 * safe" (PCA-11 brief Section 9) is implemented as FAIL-CLOSED, not
 * evict-the-oldest: once a bound is reached, `insert` simply refuses the
 * NEW record rather than silently discarding an existing one. An
 * evict-oldest policy would let a flood of new junk push out a still-valid
 * predecessor-wait another message is depending on; refusing the new
 * insert instead only ever costs the (already-independently-bounded)
 * newest arrival, and the coordinator reports that refusal honestly as a
 * REJECT rather than a silent drop.
 *
 * Per-sender and per-family caps are independent of the global cap and of
 * each other, so one sender flooding pending candidates can never starve
 * a different sender's or a different family's own headroom.
 */
export class InMemoryPendingQueueStore implements PendingQueueStore {
  private readonly byFamily = new Map<OpaqueFamilyId, Map<MessageId, PendingEnvelopeRecord>>();

  constructor(
    private readonly maxPerSender: number = MAX_PENDING_PER_SENDER,
    private readonly maxPerFamily: number = MAX_PENDING_PER_FAMILY,
    private readonly maxGlobal: number = MAX_PENDING_GLOBAL,
  ) {}

  get(familyId: OpaqueFamilyId, messageId: MessageId): PendingEnvelopeRecord | null {
    return this.byFamily.get(familyId)?.get(messageId) ?? null;
  }

  listForFamily(familyId: OpaqueFamilyId): PendingEnvelopeRecord[] {
    return [...(this.byFamily.get(familyId)?.values() ?? [])];
  }

  listForSender(familyId: OpaqueFamilyId, senderKeyId: SenderKeyId): PendingEnvelopeRecord[] {
    return this.listForFamily(familyId).filter((record) => record.senderKeyId === senderKeyId);
  }

  countForFamily(familyId: OpaqueFamilyId): number {
    return this.byFamily.get(familyId)?.size ?? 0;
  }

  countForSender(familyId: OpaqueFamilyId, senderKeyId: SenderKeyId): number {
    return this.listForSender(familyId, senderKeyId).length;
  }

  countGlobal(): number {
    let total = 0;
    for (const family of this.byFamily.values()) total += family.size;
    return total;
  }

  insert(record: PendingEnvelopeRecord): boolean {
    const existingFamilyMap = this.byFamily.get(record.familyId);
    const alreadyPresent = existingFamilyMap?.has(record.messageId) ?? false;
    if (!alreadyPresent) {
      if (this.countForSender(record.familyId, record.senderKeyId) >= this.maxPerSender) return false;
      if (this.countForFamily(record.familyId) >= this.maxPerFamily) return false;
      if (this.countGlobal() >= this.maxGlobal) return false;
    }
    let familyMap = existingFamilyMap;
    if (!familyMap) {
      familyMap = new Map();
      this.byFamily.set(record.familyId, familyMap);
    }
    familyMap.set(record.messageId, record);
    return true;
  }

  remove(familyId: OpaqueFamilyId, messageId: MessageId): void {
    const familyMap = this.byFamily.get(familyId);
    if (!familyMap) return;
    familyMap.delete(messageId);
    if (familyMap.size === 0) this.byFamily.delete(familyId);
  }

  listExpired(nowUtc: Date): PendingEnvelopeRecord[] {
    const expired: PendingEnvelopeRecord[] = [];
    for (const familyMap of this.byFamily.values()) {
      for (const record of familyMap.values()) {
        if (nowUtc.getTime() >= record.effectiveExpiresAt.getTime()) expired.push(record);
      }
    }
    return expired;
  }
}
