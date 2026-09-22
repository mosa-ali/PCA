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
 * Bounds the read-back retry when a concurrent capacity trim evicts the row a
 * duplicate-key error just told us exists -- never a normal-path loop, and the
 * same mechanism MySqlMessageIdempotencyLedger uses for the identical race.
 */
const MAX_CONFLICT_READBACK_ATTEMPTS = 3;

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
 * CAPACITY IS A RESOURCE CEILING, NOT A SECURITY CONTROL -- but it does not
 * follow that eviction has no security consequence, and an earlier version of
 * this comment wrongly claimed it could not (caught by independent review). The
 * precise position: eviction cannot let one owner READ or DISPLACE another's
 * entry -- the (scope, idempotency_key) primary key is what prevents that, and
 * eviction cannot violate it -- but evicting a row DOES reopen the replay window
 * for the key it removed, which is the exact property this ledger exists to
 * provide. Because the bound is GLOBAL rather than per-scope, a busy owner can
 * therefore evict another owner's, or the platform scope's, replay record before
 * that record's window has elapsed, degrading exactly-once to at-most-once for
 * the evicted key. `trimIfOverCapacity` is nevertheless deliberately GLOBAL,
 * matching MySqlMessageIdempotencyLedger's identical decision and migration
 * 0004's reasoning: a per-scope bound cannot bound memory at all, since the
 * number of scopes is not something this class controls. Closing the gap needs a
 * replay-RETENTION POLICY (a window and bound per scope, and what a miss means
 * to each caller) which is an architecture/security decision rather than
 * something this implementation may invent to tidy itself up; until then the
 * limitation is stated here, asserted in
 * test/familyrbac/ActionIdempotencyLedger.test.mjs, and raised as a finding
 * rather than left implicit.
 *
 * Eviction is best-effort and never on the correctness path -- a COUNT is
 * checked first so the table-wide DELETE runs only on the rare write that
 * actually overflows, because running it unconditionally inside every write's
 * own transaction caused genuine InnoDB deadlocks between unrelated concurrent
 * inserts in the envelope lane (measured live against MySQL 8.4). A failure here
 * is logged and swallowed: the write it follows has already committed, so
 * failing the caller would be a lie about the ledger's state, and at worst the
 * table briefly holds more rows than capacity until a later write trims it.
 *
 * PRIVACY. Nothing here is personal data or family content: `outcome` is the
 * caller's opaque serialized verdict, and the rest are identifiers or hashes.
 * This is deliberately NOT the family-local/E2EE family-audit store -- see
 * migration 0047's header and familyrbac/FamilyAuditStore.ts.
 */
export class MySqlActionIdempotencyLedger implements ActionIdempotencyLedger {
  constructor(private readonly capacity: number = ACTION_IDEMPOTENCY_LEDGER_CAPACITY) {
    // See ActionIdempotencyLedger's reference implementation for why a
    // non-positive budget is rejected rather than silently retaining nothing.
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new Error(`ActionIdempotencyLedger capacity must be a positive integer, got ${capacity}`);
    }
  }

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

  async record(scope: IdempotencyScope, idempotencyKey: IdempotencyKey, recorded: RecordedAuthorization): Promise<RecordedAuthorization> {
    for (let attempt = 0; attempt < MAX_CONFLICT_READBACK_ATTEMPTS; attempt += 1) {
      try {
        await runInTransaction((conn) =>
          execute(
            conn,
            `INSERT INTO action_idempotency_ledger (scope, idempotency_key, action_id, request_fingerprint, outcome, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [scope, idempotencyKey, recorded.actionId, recorded.requestFingerprint ?? null, recorded.outcome, new Date()],
          ),
        );
        await this.trimIfOverCapacity(scope, idempotencyKey);
        return recorded;
      } catch (error) {
        // Already recorded by an earlier (or concurrent) writer: first-writer-wins
        // makes this a success, not a conflict -- but the winning entry is what
        // is durable now, so it is what the caller must be told. Any other error
        // is real and must surface: swallowing it would report an authorization
        // the database never durably holds, which is the failure mode this whole
        // change exists to prevent.
        if (!isDuplicateEntry(error)) throw error;
        const existing = await this.getRecorded(scope, idempotencyKey);
        if (existing !== null) return existing;
        // Bounded TOCTOU: the winning row was evicted (capacity trim) between our
        // failed INSERT and this read. Retry the INSERT rather than claim an
        // outcome nothing holds -- see MAX_CONFLICT_READBACK_ATTEMPTS.
      }
    }
    throw new Error(`ActionIdempotencyLedger could not record or read back (${scope}, ${idempotencyKey}) after ${MAX_CONFLICT_READBACK_ATTEMPTS} attempts.`);
  }

  /**
   * The (scope, idempotencyKey) just written is excluded from the delete, not
   * merely assumed to survive it. Ordering is by created_at, which is
   * millisecond precision, so two writes in the same millisecond are TIED and
   * the tie-break is whatever InnoDB returns -- without this exclusion the row
   * this call just committed could be the one the trim removes, i.e. a write
   * that reported success would have been silently undone by its own cleanup.
   */
  private async trimIfOverCapacity(justWrittenScope: IdempotencyScope, justWrittenKey: IdempotencyKey): Promise<void> {
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
           )
           AND NOT (scope = ? AND idempotency_key = ?)`,
          [this.capacity, justWrittenScope, justWrittenKey],
        ),
      );
    } catch (error) {
      // Best-effort by design (see this class's doc comment), but never SILENT:
      // a bare catch here hid a permanently failing trim behind a soft-ceiling
      // claim, which is how a stale table looks identical to a healthy one. The
      // caller's write has already committed, so this must not fail the write.
      console.warn(
        JSON.stringify({
          event: 'action_idempotency_ledger_trim_failed',
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }
}
