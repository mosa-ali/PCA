import { execute, runInTransaction } from '../db/pool.js';
import type { OpaqueFamilyId, SenderKeyId } from './types.js';
import type { ReplayLedger } from './ReplayLedger.js';
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
