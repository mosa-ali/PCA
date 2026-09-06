import { execute, isDuplicateEntry, runInTransaction } from '../db/pool.js';
import type { DeleteNowLedger, DeleteNowRecord } from './DeleteNowLedger.js';
import type { PurgePlan } from './engine.js';

interface LedgerRow {
  purge_plan: PurgePlan;
  completed_at: Date;
}

/**
 * PCA-DW-W3-D -- durable, MySQL-backed DeleteNowLedger (migration
 * 0040_delete_now_ledger.sql), the drop-in replacement for
 * InMemoryDeleteNowLedger. Losing this ledger's state on restart is a real
 * (if narrow) idempotency gap: applyDeleteNow's "first call computes and
 * records, every replay returns the exact same stored plan" contract
 * silently resets to "never seen" after a restart, letting a duplicated
 * client instruction recompute a purge plan against whatever data exists
 * at replay time rather than the plan actually already applied.
 *
 * `record` mirrors InMemoryDeleteNowLedger's "first completion wins"
 * semantics exactly: a plain INSERT (never ON DUPLICATE KEY UPDATE), so a
 * concurrent/replayed record() for an actionId that already committed
 * fails with a duplicate-key error, which is caught and silently ignored
 * here -- the FIRST writer's plan is authoritative and is never
 * overwritten by a later one, matching applyDeleteNow's own
 * "idempotent: true" replay path (which calls get(), not record(), once a
 * row exists).
 */
export class MySqlDeleteNowLedger implements DeleteNowLedger {
  async get(actionId: string): Promise<DeleteNowRecord | null> {
    const { rows } = await runInTransaction((conn) =>
      execute<LedgerRow>(conn, `SELECT purge_plan, completed_at FROM delete_now_ledger WHERE action_id = ?`, [actionId]),
    );
    const row = rows[0];
    if (!row) return null;
    return { actionId, plan: row.purge_plan, completedAtUtc: row.completed_at };
  }

  async record(actionId: string, plan: PurgePlan, completedAtUtc: Date): Promise<void> {
    try {
      await runInTransaction((conn) =>
        execute(
          conn,
          `INSERT INTO delete_now_ledger (action_id, purge_plan, completed_at) VALUES (?, ?, ?)`,
          [actionId, JSON.stringify(plan), completedAtUtc],
        ),
      );
    } catch (error) {
      if (!isDuplicateEntry(error)) throw error;
      // Lost the race (or this is a genuine replay) -- the existing row's
      // plan is authoritative; see this class's own doc comment.
    }
  }
}
