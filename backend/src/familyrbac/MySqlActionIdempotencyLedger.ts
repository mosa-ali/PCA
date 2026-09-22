import { execute, isDuplicateEntry, runInTransaction } from '../db/pool.js';
import type { ActionIdempotencyLedger, IdempotencyScope, RecordedAuthorization } from './ActionIdempotencyLedger.js';
import type { IdempotencyKey } from './types.js';
import { ACTION_IDEMPOTENCY_LEDGER_CAPACITY } from './policy.js';

interface IdempotencyRow {
  action_id: string;
  request_fingerprint: string | null;
  outcome: string;
}

/**
 * Durable, MySQL-backed ActionIdempotencyLedger -- the P1-04 drop-in
 * replacement for InMemoryActionIdempotencyLedger.
 *
 * WHY DURABILITY IS THE POINT. Losing this ledger's state on restart is not a
 * cache miss, it is a reopened replay window: a retry that the server had
 * already recorded an authorization outcome for would be re-evaluated against
 * trust-set state that may have changed in between, so the SAME (actionId,
 * idempotencyKey) could produce a DIFFERENT verdict than the one the caller
 * already acted on. The in-memory implementation also made the guarantee
 * per-process, so a multi-instance deployment gave each instance its own
 * partial protection.
 *
 * FIRST WRITER WINS, ARBITRATED BY THE PRIMARY KEY, exactly as
 * MySqlMessageIdempotencyLedger does for envelopes and for the same reason: a
 * plain INSERT (no ON DUPLICATE KEY UPDATE) means exactly one concurrent write
 * for a given (scope, idempotency_key) can succeed, and InnoDB's unique index
 * -- enforced engine-side across every connection and process sharing this
 * database -- is the actual cross-instance arbiter rather than anything this
 * class reimplements in application code. A loser of that race sees ER_DUP_ENTRY
 * and treats it as "already recorded", which IS the correct outcome under
 * first-writer-wins; it must never overwrite, or a caller reusing another
 * owner's key could permanently displace that owner's recorded authorization.
 * See ActionIdempotencyLedger.ts's own doc comment for why overwriting is the
 * weaker option, and why a mismatching (actionId, requestFingerprint) already
 * forces a fresh evaluation at the call site rather than here.
 *
 * CAPACITY IS A RESOURCE CEILING, NOT A SECURITY CONTROL. `trimIfOverCapacity`
 * is deliberately GLOBAL rather than per-scope, matching
 * MySqlMessageIdempotencyLedger's identical decision and migration 0004's
 * reasoning: the security property is the (scope, idempotency_key) primary key,
 * which eviction cannot affect. Eviction is best-effort and never on the
 * correctness path -- a COUNT is checked first so the table-wide DELETE runs
 * only on the rare write that actually overflows, because running it
 * unconditionally inside every write's own transaction caused genuine InnoDB
 * deadlocks between unrelated concurrent inserts in the envelope lane (measured
 * live against MySQL 8.4). A deadlock here is swallowed: at worst the table
 * briefly holds more rows than capacity until a later write trims it.
 *
 * PRIVACY. Nothing here is personal data or family content: `outcome` is the
 * caller's opaque serialized verdict, and the rest are identifiers or hashes.
 * This is deliberately NOT the family-local/E2EE family-audit store -- see
 * migration 0047's header and familyrbac/FamilyAuditStore.ts.
 */
export class MySqlActionIdempotencyLedger implements ActionIdempotencyLedger {
  constructor(private readonly capacity: number = ACTION_IDEMPOTENCY_LEDGER_CAPACITY) {}

  async getRecorded(scope: IdempotencyScope, idempotencyKey: IdempotencyKey): Promise<RecordedAuthorization | null> {
    const { rows } = await runInTransaction((conn) =>
      execute<IdempotencyRow>(
        conn,
        `SELECT action_id, request_fingerprint, outcome FROM action_idempotency_ledger WHERE scope = ? AND idempotency_key = ?`,
        [scope, idempotencyKey],
      ),
    );
    const row = rows[0];
    if (row === undefined) return null;
    return {
      actionId: row.action_id,
      // Absent stays absent: an undefined fingerprint must not become the
      // string "null", or a caller that never populates it would compare
      // against a value it never wrote.
      requestFingerprint: row.request_fingerprint ?? undefined,
      outcome: row.outcome,
    };
  }

  async record(scope: IdempotencyScope, idempotencyKey: IdempotencyKey, recorded: RecordedAuthorization): Promise<void> {
    if (this.capacity <= 0) return;
    try {
      await runInTransaction((conn) =>
        execute(
          conn,
          `INSERT INTO action_idempotency_ledger (scope, idempotency_key, action_id, request_fingerprint, outcome, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [scope, idempotencyKey, recorded.actionId, recorded.requestFingerprint ?? null, recorded.outcome, new Date()],
        ),
      );
    } catch (error) {
      // Already recorded by an earlier (or concurrent) writer: first-writer-wins
      // makes this a success, not a conflict. Any other error is real and must
      // surface -- swallowing it here would report a recorded authorization the
      // database never durably holds, which is the failure mode this whole
      // change exists to prevent.
      if (!isDuplicateEntry(error)) throw error;
    }
    await this.trimIfOverCapacity();
  }

  private async trimIfOverCapacity(): Promise<void> {
    try {
      const { rows: countRows } = await runInTransaction((conn) =>
        execute<{ n: number }>(conn, `SELECT COUNT(*) AS n FROM action_idempotency_ledger`),
      );
      const total = countRows[0]?.n ?? 0;
      if (total <= this.capacity) return;
      await runInTransaction((conn) =>
        execute(
          conn,
          `DELETE FROM action_idempotency_ledger
           WHERE (scope, idempotency_key) NOT IN (
             SELECT scope, idempotency_key FROM (
               SELECT scope, idempotency_key FROM action_idempotency_ledger
               ORDER BY created_at DESC
               LIMIT ?
             ) keep
           )`,
          [this.capacity],
        ),
      );
    } catch {
      // Deliberately swallowed -- see this class's doc comment. The ceiling is
      // soft; correctness and security never depend on it.
    }
  }
}
