import { execute, runInTransaction } from '../db/pool.js';
import type { SenderKeyId } from './types.js';
import type { ReplayLedger } from './ReplayLedger.js';
import { REPLAY_LEDGER_CAPACITY_PER_SENDER } from './policy.js';

interface ReplayRow {
  n: number;
}

/**
 * Durable, MySQL-backed ReplayLedger -- the PCA-SYNC-DURABILITY-1 drop-in
 * replacement for InMemoryReplayLedger. SAME interface contract, SAME
 * bounded-per-sender eviction policy (oldest-by-insertion-order once
 * REPLAY_LEDGER_CAPACITY_PER_SENDER is reached), but state now survives a
 * backend-process restart -- this is the anti-replay authority itself, so
 * losing it on restart would silently reopen the exact replay hole a
 * reviewed EnvelopeSignatureVerifier's acceptance pipeline depends on this
 * ledger to close (see FamilyEnvelopeVerifier.evaluateEnvelope).
 *
 * `hasProcessed` + `recordProcessed` are two separate calls (matching the
 * existing interface, unchanged), so this is not a single atomic
 * check-and-set at the DB layer either -- exactly the same TOCTOU shape the
 * in-memory Map had. That race is out of this class's scope: SyncCoordinator
 * already documents (PCA11_ORDERING_CONCURRENCY) that per-(familyId,
 * messageId) serialization is the caller's fix for concurrent submissions
 * of the SAME messageId; this class's own job is durability, not changing
 * evaluateEnvelope's accepted concurrency contract. `recordProcessed` is
 * idempotent (INSERT ... ON DUPLICATE KEY UPDATE, never throws) so a
 * duplicate recordProcessed call for an already-recorded (senderKeyId,
 * sequenceOrNonce) pair -- whether a genuine retry or a benign race -- is a
 * harmless no-op, exactly like the in-memory Set's `.add()`.
 */
export class MySqlReplayLedger implements ReplayLedger {
  constructor(private readonly capacityPerSender: number = REPLAY_LEDGER_CAPACITY_PER_SENDER) {}

  async hasProcessed(senderKeyId: SenderKeyId, sequenceOrNonce: string): Promise<boolean> {
    return runInTransaction(async (conn) => {
      const { rows } = await execute<ReplayRow>(
        conn,
        `SELECT 1 AS n FROM envelope_replay_ledger WHERE sender_key_id = ? AND sequence_or_nonce = ? LIMIT 1`,
        [senderKeyId, sequenceOrNonce],
      );
      return rows.length > 0;
    });
  }

  async recordProcessed(senderKeyId: SenderKeyId, sequenceOrNonce: string): Promise<void> {
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
        `INSERT INTO envelope_replay_ledger (sender_key_id, sequence_or_nonce, recorded_at)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE recorded_at = recorded_at`,
        [senderKeyId, sequenceOrNonce, now],
      ),
    );
    await this.trimIfOverCapacity(senderKeyId);
  }

  /**
   * Bounded-per-sender eviction: keep only the newest capacityPerSender
   * rows (by insertion order / id) for this sender_key_id, deleting any
   * older overflow -- the same oldest-first policy
   * InMemoryReplayLedger's Set-with-tracked-insertion-order enforces.
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
  private async trimIfOverCapacity(senderKeyId: SenderKeyId): Promise<void> {
    try {
      const { rows: countRows } = await runInTransaction((conn) =>
        execute<{ n: number }>(conn, `SELECT COUNT(*) AS n FROM envelope_replay_ledger WHERE sender_key_id = ?`, [
          senderKeyId,
        ]),
      );
      const total = countRows[0]?.n ?? 0;
      if (total <= this.capacityPerSender) return;
      await runInTransaction((conn) =>
        execute(
          conn,
          `DELETE FROM envelope_replay_ledger
           WHERE sender_key_id = ?
             AND id NOT IN (
               SELECT id FROM (
                 SELECT id FROM envelope_replay_ledger
                 WHERE sender_key_id = ?
                 ORDER BY id DESC
                 LIMIT ?
               ) keep
             )`,
          [senderKeyId, senderKeyId, this.capacityPerSender],
        ),
      );
    } catch {
      // Best-effort eviction -- see doc comment above.
    }
  }
}
