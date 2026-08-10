import type { SenderKeyId } from './types.js';
import type { ReplayLedger } from './ReplayLedger.js';
import { REPLAY_LEDGER_CAPACITY_PER_SENDER } from './policy.js';

/**
 * Bounded, in-memory reference ReplayLedger (doc 09 Section 4: "receivers
 * maintain a BOUNDED per-sender replay ledger"). Unlike
 * EnvelopeSignatureVerifier, this is NOT a crypto-sensitive choice gated
 * behind security review -- replay-ledger bookkeeping has no algorithm
 * suite to select, so this is a real, usable implementation, not a
 * test-only stand-in. Production device-side storage may still choose a
 * different backing store (e.g. platform-persistent storage surviving app
 * restarts) by implementing the same ReplayLedger interface; this class is
 * the process-memory-only default.
 *
 * Bounding strategy: each sender-key's seen-set is capped at
 * REPLAY_LEDGER_CAPACITY_PER_SENDER entries; insertion order is tracked so
 * the oldest entry is evicted first once the cap is reached. This is a
 * best-effort bound, not a perfect LRU -- eviction is by insertion order,
 * not last-access order, which is the correct trade-off here since replay
 * checks should favor recently-issued sequence/nonce values, not
 * recently-checked ones.
 */
export class InMemoryReplayLedger implements ReplayLedger {
  private readonly seenBySender = new Map<SenderKeyId, Set<string>>();
  private readonly capacityPerSender: number;

  constructor(capacityPerSender: number = REPLAY_LEDGER_CAPACITY_PER_SENDER) {
    this.capacityPerSender = capacityPerSender;
  }

  hasProcessed(senderKeyId: SenderKeyId, sequenceOrNonce: string): boolean {
    return this.seenBySender.get(senderKeyId)?.has(sequenceOrNonce) ?? false;
  }

  recordProcessed(senderKeyId: SenderKeyId, sequenceOrNonce: string): void {
    // A cap of 0 (or less) means "remember nothing" -- without this guard,
    // an empty set's eviction step is a no-op (nothing to evict yet) and
    // the entry would still be added, silently admitting one entry despite
    // a supposed zero capacity.
    if (this.capacityPerSender <= 0) return;
    let seen = this.seenBySender.get(senderKeyId);
    if (!seen) {
      seen = new Set();
      this.seenBySender.set(senderKeyId, seen);
    }
    if (seen.has(sequenceOrNonce)) return;
    if (seen.size >= this.capacityPerSender) {
      const oldest = seen.values().next().value;
      if (oldest !== undefined) seen.delete(oldest);
    }
    seen.add(sequenceOrNonce);
  }
}
