import { execute, isDuplicateEntry, runInTransaction } from '../db/pool.js';
import type { OpaqueFamilyId, SenderKeyId } from './types.js';
import type { ClaimReplayResult, ReplayLedger } from './ReplayLedger.js';
import { REPLAY_LEDGER_CAPACITY_PER_SENDER } from './policy.js';

interface ReplayRow {
  n: number;
}

/**
 * Durable, MySQL-backed ReplayLedger -- the PCA-SYNC-DURABILITY-1 drop-in
 * replacement for InMemoryReplayLedger. SAME interface contract, SAME
 * bounded eviction policy (oldest-by-insertion-order once
 * REPLAY_LEDGER_CAPACITY_PER_SENDER is reached), but state now survives a
 * backend-process restart -- this is the anti-replay authority itself, so
 * losing it on restart would silently reopen the exact replay hole a
 * reviewed EnvelopeSignatureVerifier's acceptance pipeline depends on this
 * ledger to close (see FamilyEnvelopeVerifier.evaluateEnvelope).
 *
 * PCA-17C RUNTIME-SYNC-ACCEPTANCE-INTEGRITY: every row is now scoped by
 * `family_id` (migration 0004) -- the unique key is
 * (family_id, sender_key_id, sequence_or_nonce), and the bounded-eviction
 * dimension narrows from "per sender_key_id globally" to "per
 * (family_id, sender_key_id)" (see migration 0004's header for why: a
 * cross-family senderKeyId collision must never let one family's traffic
 * evict another family's replay entries). `family_id` here is ALWAYS the
 * caller's authoritative, session-derived family identity -- see
 * FamilyEnvelopeVerifier's EnvelopeAcceptanceContext.familyId doc comment
 * -- never envelope.familyId.
 *
 * `hasProcessed` + `recordProcessed` are two separate calls (matching the
 * existing interface, unchanged), so this is not a single atomic
 * check-and-set at the DB layer either -- exactly the same TOCTOU shape the
 * in-memory Map had. That race is out of this class's scope: SyncCoordinator
 * already documents (PCA11_ORDERING_CONCURRENCY) that per-(familyId,
 * messageId) serialization is the caller's fix for concurrent submissions
 * of the SAME messageId within one process; this class's own job is
 * durability, not changing evaluateEnvelope's accepted concurrency
 * contract. `recordProcessed` is idempotent (INSERT ... ON DUPLICATE KEY
 * UPDATE, never throws) so a duplicate recordProcessed call for an
 * already-recorded (familyId, senderKeyId, sequenceOrNonce) triple --
 * whether a genuine retry or a benign race -- is a harmless no-op, exactly
 * like the in-memory Set's `.add()`. Unlike MessageIdempotencyLedger, this
 * is safe: there is no "content" associated with a replay-ledger row
 * beyond its own existence (see ReplayLedger.ts's doc comment) -- two
 * concurrent recordProcessed calls for the identical key can never
 * disagree about what should be stored, so an unconditional no-op-on-
 * duplicate UPSERT introduces no silent-overwrite risk the way
 * MessageIdempotencyLedger's canonical_bytes column would.
 */
export class MySqlReplayLedger implements ReplayLedger {
  constructor(private readonly capacityPerSender: number = REPLAY_LEDGER_CAPACITY_PER_SENDER) {}

  async hasProcessed(familyId: OpaqueFamilyId, senderKeyId: SenderKeyId, sequenceOrNonce: string): Promise<boolean> {
    return runInTransaction(async (conn) => {
      const { rows } = await execute<ReplayRow>(
        conn,
        `SELECT 1 AS n FROM envelope_replay_ledger WHERE family_id = ? AND sender_key_id = ? AND sequence_or_nonce = ? LIMIT 1`,
        [familyId, senderKeyId, sequenceOrNonce],
      );
      return rows.length > 0;
    });
  }

  async recordProcessed(familyId: OpaqueFamilyId, senderKeyId: SenderKeyId, sequenceOrNonce: string): Promise<void> {
    // A cap of 0 (or less) means "remember nothing" -- mirrors
    // InMemoryReplayLedger's identical guard.
    if (this.capacityPerSender <= 0) return;
    const now = new Date();
    // The INSERT is its own short transaction -- correctness (durably
    // recording this sender's processed sequence/nonce, the actual
    // anti-replay guarantee) must never be blocked or failed by eviction
    // bookkeeping. See trimIfOverCapacity's doc comment for why.
    await runInTransaction((conn) =>
      execute(
        conn,
        `INSERT INTO envelope_replay_ledger (family_id, sender_key_id, sequence_or_nonce, recorded_at)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE recorded_at = recorded_at`,
        [familyId, senderKeyId, sequenceOrNonce, now],
      ),
    );
    await this.trimIfOverCapacity(familyId, senderKeyId);
  }

  /**
   * PCA-17E REPLAY_MULTI_INSTANCE_TOCTOU: unlike `recordProcessed` above
   * (an unconditional, always-succeeds UPSERT -- fine for its own
   * best-effort "mark processed" contract, but useless as a cross-instance
   * race arbiter since it never tells the caller whether IT won), this
   * issues a PLAIN INSERT with no `ON DUPLICATE KEY UPDATE`. MySQL/InnoDB's
   * UNIQUE KEY on (family_id, sender_key_id, sequence_or_nonce) -- the same
   * key `hasProcessed`/`recordProcessed` already rely on -- is the actual
   * cross-process arbiter: exactly one concurrent INSERT for a given key
   * can ever succeed; every other concurrent INSERT for that same key
   * blocks on the unique index's row/gap lock until the winner's
   * transaction resolves, then itself fails with ER_DUP_ENTRY once the
   * winner commits (the ordinary case) -- see
   * MySqlMessageIdempotencyLedger's identical mechanism/reasoning for the
   * message-idempotency ledger.
   */
  async claimProcessed(familyId: OpaqueFamilyId, senderKeyId: SenderKeyId, sequenceOrNonce: string): Promise<ClaimReplayResult> {
    if (this.capacityPerSender <= 0) return 'claimed'; // "remember nothing" -- see recordProcessed's identical guard.
    const now = new Date();
    try {
      await runInTransaction((conn) =>
        execute(
          conn,
          `INSERT INTO envelope_replay_ledger (family_id, sender_key_id, sequence_or_nonce, recorded_at) VALUES (?, ?, ?, ?)`,
          [familyId, senderKeyId, sequenceOrNonce, now],
        ),
      );
    } catch (error) {
      if (!isDuplicateEntry(error)) throw error;
      return 'already-claimed';
    }
    await this.trimIfOverCapacity(familyId, senderKeyId);
    return 'claimed';
  }

  /**
   * Compensating undo for a claim THIS caller just won -- see
   * ReplayLedger.ts's doc comment on why this must only ever target a key
   * this exact call won. A plain DELETE on the same unique key; best-effort
   * is not appropriate here (unlike trimIfOverCapacity) because a failed
   * release would leave a nonce permanently, incorrectly burned for a
   * legitimate future retransmission -- if this throws, the caller's
   * rejection decision still stands (the envelope is still correctly
   * rejected), but the stuck claim itself is a real, surfaced failure the
   * caller should propagate rather than silently swallow.
   */
  async releaseClaim(familyId: OpaqueFamilyId, senderKeyId: SenderKeyId, sequenceOrNonce: string): Promise<void> {
    await runInTransaction((conn) =>
      execute(
        conn,
        `DELETE FROM envelope_replay_ledger WHERE family_id = ? AND sender_key_id = ? AND sequence_or_nonce = ?`,
        [familyId, senderKeyId, sequenceOrNonce],
      ),
    );
  }

  /**
   * Bounded-per-(family, sender) eviction: keep only the newest
   * capacityPerSender rows (by insertion order / id) for this
   * (family_id, sender_key_id) pair, deleting any older overflow -- the
   * same oldest-first policy InMemoryReplayLedger's nested Map (with
   * tracked insertion order) enforces, now correctly partitioned per
   * family (see migration 0004's header).
   *
   * Deliberately best-effort and NEVER on the critical/correctness path --
   * see MySqlMessageIdempotencyLedger.trimIfOverCapacity's identical
   * reasoning (a cheap per-sender COUNT first, DELETE only when actually
   * over capacity, deadlocks/lock-wait-timeouts swallowed rather than
   * rethrown). Confirmed live: running an unconditional per-write DELETE
   * inside the same transaction as the INSERT produced real InnoDB
   * deadlocks under concurrent writes during this lane's own concurrency
   * testing.
   */
  private async trimIfOverCapacity(familyId: OpaqueFamilyId, senderKeyId: SenderKeyId): Promise<void> {
    try {
      const { rows: countRows } = await runInTransaction((conn) =>
        execute<{ n: number }>(
          conn,
          `SELECT COUNT(*) AS n FROM envelope_replay_ledger WHERE family_id = ? AND sender_key_id = ?`,
          [familyId, senderKeyId],
        ),
      );
      const total = countRows[0]?.n ?? 0;
      if (total <= this.capacityPerSender) return;
      await runInTransaction((conn) =>
        execute(
          conn,
          `DELETE FROM envelope_replay_ledger
           WHERE family_id = ? AND sender_key_id = ?
             AND id NOT IN (
               SELECT id FROM (
                 SELECT id FROM envelope_replay_ledger
                 WHERE family_id = ? AND sender_key_id = ?
                 ORDER BY id DESC
                 LIMIT ?
               ) keep
             )`,
          [familyId, senderKeyId, familyId, senderKeyId, this.capacityPerSender],
        ),
      );
    } catch {
      // Best-effort eviction -- see doc comment above.
    }
  }
}
