import type { MessageId } from './types.js';
import type { MessageIdempotencyLedger } from './MessageIdempotencyLedger.js';
import { MESSAGE_IDEMPOTENCY_LEDGER_CAPACITY } from './policy.js';

/**
 * Bounded, in-memory reference MessageIdempotencyLedger. Like
 * InMemoryReplayLedger/InMemoryDataVersionLedger, this is ordinary
 * bookkeeping with no crypto-sensitive algorithm choice, so it is a
 * real, usable default -- not a test-only stand-in.
 *
 * Bounding strategy: capped at MESSAGE_IDEMPOTENCY_LEDGER_CAPACITY total
 * entries (global, not per-sender, since messageId is itself already
 * globally unique per doc 22); insertion order is tracked so the oldest
 * entry is evicted first once the cap is reached.
 */
export class InMemoryMessageIdempotencyLedger implements MessageIdempotencyLedger {
  private readonly canonicalBytesByMessageId = new Map<MessageId, string>();
  private readonly capacity: number;

  constructor(capacity: number = MESSAGE_IDEMPOTENCY_LEDGER_CAPACITY) {
    this.capacity = capacity;
  }

  async getAcceptedCanonicalBytes(messageId: MessageId): Promise<string | null> {
    return this.canonicalBytesByMessageId.get(messageId) ?? null;
  }

  async recordAccepted(messageId: MessageId, canonicalBytes: string): Promise<void> {
    if (this.capacity <= 0) return;
    if (this.canonicalBytesByMessageId.has(messageId)) {
      this.canonicalBytesByMessageId.set(messageId, canonicalBytes);
      return;
    }
    if (this.canonicalBytesByMessageId.size >= this.capacity) {
      const oldestKey = this.canonicalBytesByMessageId.keys().next().value;
      if (oldestKey !== undefined) this.canonicalBytesByMessageId.delete(oldestKey);
    }
    this.canonicalBytesByMessageId.set(messageId, canonicalBytes);
  }
}
