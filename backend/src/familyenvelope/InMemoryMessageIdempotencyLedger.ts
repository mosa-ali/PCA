import type { MessageId, OpaqueFamilyId } from './types.js';
import type { MessageIdempotencyLedger, RecordAcceptedResult } from './MessageIdempotencyLedger.js';
import { MESSAGE_IDEMPOTENCY_LEDGER_CAPACITY } from './policy.js';

/**
 * Bounded, in-memory reference MessageIdempotencyLedger. Like
 * InMemoryReplayLedger/InMemoryDataVersionLedger, this is ordinary
 * bookkeeping with no crypto-sensitive algorithm choice, so it is a
 * real, usable default -- not a test-only stand-in.
 *
 * PCA-17C RUNTIME-SYNC-ACCEPTANCE-INTEGRITY: keyed by a nested Map
 * (familyId -> messageId -> canonicalBytes), not a delimiter-joined string
 * key -- see InMemoryReplayLedger.ts's identical doc comment. `recordAccepted`
 * now returns a RecordAcceptedResult (conflict-aware) instead of `void`,
 * matching MySqlMessageIdempotencyLedger's drop-in-replacement contract --
 * see that class's doc comment for the cross-instance-atomicity reasoning
 * this in-memory implementation does not itself need (single JS process,
 * naturally atomic between one `await` and the next with no other ledger
 * I/O interleaved) but must still report identically, so callers written
 * against one backend behave the same against the other.
 *
 * Bounding strategy: capped at MESSAGE_IDEMPOTENCY_LEDGER_CAPACITY total
 * entries GLOBALLY (not per-family) -- unchanged from before this lane;
 * see migration 0004's header for why the durable backend also keeps this
 * eviction dimension global while still scoping the UNIQUENESS/conflict
 * guarantee per family.
 */
export class InMemoryMessageIdempotencyLedger implements MessageIdempotencyLedger {
  private readonly canonicalBytesByFamily = new Map<OpaqueFamilyId, Map<MessageId, string>>();
  /** Global insertion-order record of (familyId, messageId) pairs, for global eviction. */
  private readonly insertionOrder: Array<{ familyId: OpaqueFamilyId; messageId: MessageId }> = [];
  private readonly capacity: number;

  constructor(capacity: number = MESSAGE_IDEMPOTENCY_LEDGER_CAPACITY) {
    this.capacity = capacity;
  }

  async getAcceptedCanonicalBytes(familyId: OpaqueFamilyId, messageId: MessageId): Promise<string | null> {
    return this.canonicalBytesByFamily.get(familyId)?.get(messageId) ?? null;
  }

  async recordAccepted(familyId: OpaqueFamilyId, messageId: MessageId, canonicalBytes: string): Promise<RecordAcceptedResult> {
    if (this.capacity <= 0) return { outcome: 'recorded' };
    const byMessage = this.canonicalBytesByFamily.get(familyId);
    const existing = byMessage?.get(messageId);
    if (existing !== undefined) {
      return existing === canonicalBytes ? { outcome: 'already-idempotent' } : { outcome: 'conflict' };
    }
    let target = byMessage;
    if (!target) {
      target = new Map();
      this.canonicalBytesByFamily.set(familyId, target);
    }
    if (this.insertionOrder.length >= this.capacity) {
      const oldest = this.insertionOrder.shift();
      if (oldest) {
        const oldestBucket = this.canonicalBytesByFamily.get(oldest.familyId);
        oldestBucket?.delete(oldest.messageId);
        if (oldestBucket && oldestBucket.size === 0) this.canonicalBytesByFamily.delete(oldest.familyId);
      }
    }
    target.set(messageId, canonicalBytes);
    this.insertionOrder.push({ familyId, messageId });
    return { outcome: 'recorded' };
  }
}
