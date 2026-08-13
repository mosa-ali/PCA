import type { OpaqueFamilyId, SenderKeyId } from './types.js';
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
 * PCA-17C RUNTIME-SYNC-ACCEPTANCE-INTEGRITY: keyed by a genuine nested Map
 * (familyId -> senderKeyId -> Set<sequenceOrNonce>), deliberately NOT a
 * single Map keyed by a delimiter-joined string -- opaque ids here have no
 * charset restriction (see policy.ts's isPlausibleOpaqueId, length-only),
 * so a joined-string key could otherwise let two DIFFERENT (familyId,
 * senderKeyId) pairs collide onto the same composite key (e.g.
 * familyId="a:b", senderKeyId="c" vs. familyId="a", senderKeyId="b:c" for
 * any chosen delimiter). Nesting real Map lookups makes that class of
 * collision structurally impossible rather than merely unlikely.
 *
 * Bounding strategy: each (family, sender-key) pair's seen-set is capped
 * at REPLAY_LEDGER_CAPACITY_PER_SENDER entries; insertion order is tracked
 * so the oldest entry is evicted first once the cap is reached. This is a
 * best-effort bound, not a perfect LRU -- eviction is by insertion order,
 * not last-access order, which is the correct trade-off here since replay
 * checks should favor recently-issued sequence/nonce values, not
 * recently-checked ones.
 */
export class InMemoryReplayLedger implements ReplayLedger {
  private readonly seenByFamily = new Map<OpaqueFamilyId, Map<SenderKeyId, Set<string>>>();
  private readonly capacityPerSender: number;

  constructor(capacityPerSender: number = REPLAY_LEDGER_CAPACITY_PER_SENDER) {
    this.capacityPerSender = capacityPerSender;
  }

  async hasProcessed(familyId: OpaqueFamilyId, senderKeyId: SenderKeyId, sequenceOrNonce: string): Promise<boolean> {
    return this.seenByFamily.get(familyId)?.get(senderKeyId)?.has(sequenceOrNonce) ?? false;
  }

  async recordProcessed(familyId: OpaqueFamilyId, senderKeyId: SenderKeyId, sequenceOrNonce: string): Promise<void> {
    // A cap of 0 (or less) means "remember nothing" -- without this guard,
    // an empty set's eviction step is a no-op (nothing to evict yet) and
    // the entry would still be added, silently admitting one entry despite
    // a supposed zero capacity.
    if (this.capacityPerSender <= 0) return;
    let bySender = this.seenByFamily.get(familyId);
    if (!bySender) {
      bySender = new Map();
      this.seenByFamily.set(familyId, bySender);
    }
    let seen = bySender.get(senderKeyId);
    if (!seen) {
      seen = new Set();
      bySender.set(senderKeyId, seen);
    }
    if (seen.has(sequenceOrNonce)) return;
    if (seen.size >= this.capacityPerSender) {
      const oldest = seen.values().next().value;
      if (oldest !== undefined) seen.delete(oldest);
    }
    seen.add(sequenceOrNonce);
  }
}
