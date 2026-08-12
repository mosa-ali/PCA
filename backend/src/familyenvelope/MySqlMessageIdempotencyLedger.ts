import { execute, runInTransaction } from '../db/pool.js';
import type { MessageId } from './types.js';
import type { MessageIdempotencyLedger } from './MessageIdempotencyLedger.js';
import { MESSAGE_IDEMPOTENCY_LEDGER_CAPACITY } from './policy.js';

interface IdempotencyRow {
  canonical_bytes: Buffer;
}

/**
 * Durable, MySQL-backed MessageIdempotencyLedger -- the PCA-SYNC-DURABILITY-1
 * drop-in replacement for InMemoryMessageIdempotencyLedger. Losing this
 * ledger's state on restart is a genuine idempotency/integrity regression:
 * FamilyEnvelopeVerifier.evaluateEnvelope relies on
 * getAcceptedCanonicalBytes to (a) short-circuit a byte-identical
 * redelivery as a stable, already-applied receipt and (b) reject a
 * DIFFERENT envelope reusing an already-accepted messageId as
 * MESSAGE_ID_CONFLICT -- a restart that resets this to "never seen" would
 * let a reused messageId be silently treated as brand new, defeating (b).
 *
 * `canonical_bytes` is stored as MEDIUMBLOB (opaque bytes) even though the
 * in-memory ledger holds it as a plain JS string -- canonicalizeEnvelope's
 * output is UTF-8-safe text, so the round trip (`Buffer.from(str, 'utf8')`
 * in, `.toString('utf8')` out) is lossless; storing it as a BLOB rather
 * than VARCHAR/TEXT matches this schema's established privacy posture for
 * every other opaque/signed-content column (see migration 0002's header).
 *
 * `recordAccepted` mirrors the in-memory Map's `.set()` semantics exactly:
 * unconditional overwrite on an existing messageId (this class does not
 * itself decide whether that should ever happen -- see
 * MessageIdempotencyLedger.ts's own doc comment on which acceptance paths
 * actually call this).
 */
export class MySqlMessageIdempotencyLedger implements MessageIdempotencyLedger {
  constructor(private readonly capacity: number = MESSAGE_IDEMPOTENCY_LEDGER_CAPACITY) {}

  async getAcceptedCanonicalBytes(messageId: MessageId): Promise<string | null> {
    const { rows } = await runInTransaction((conn) =>
      execute<IdempotencyRow>(
        conn,
        `SELECT canonical_bytes FROM envelope_message_idempotency_ledger WHERE message_id = ?`,
        [messageId],
      ),
    );
    const row = rows[0];
    return row ? row.canonical_bytes.toString('utf8') : null;
  }

  async recordAccepted(messageId: MessageId, canonicalBytes: string): Promise<void> {
    if (this.capacity <= 0) return;
    const now = new Date();
    const bytes = Buffer.from(canonicalBytes, 'utf8');
    // The INSERT is its own short transaction -- correctness (durably
    // recording this messageId's canonical bytes) must never be blocked or
    // failed by eviction bookkeeping. Eviction is a resource-abuse ceiling,
    // not a security control (see this class's own doc comment and
    // migration 0002's header), so it is handled entirely separately below.
    await runInTransaction((conn) =>
      execute(
        conn,
        `INSERT INTO envelope_message_idempotency_ledger (message_id, canonical_bytes, recorded_at)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE canonical_bytes = VALUES(canonical_bytes), recorded_at = VALUES(recorded_at)`,
        [messageId, bytes, now],
      ),
    );
    await this.trimIfOverCapacity();
  }

  /**
   * Bounded GLOBAL eviction: keep only the newest `capacity` rows (by
   * insertion order / id), deleting any older overflow -- the same
   * oldest-first policy InMemoryMessageIdempotencyLedger's Map (with
   * tracked insertion order) enforces.
   *
   * Deliberately best-effort and NEVER on the critical/correctness path:
   * a cheap COUNT first means the DELETE (a table-wide scan that briefly
   * gap-locks under InnoDB) only ever runs on the rare write that actually
   * pushes the table over capacity, not on every single recordAccepted
   * call -- under concurrent load, running that DELETE unconditionally
   * inside every write's own transaction caused genuine InnoDB deadlocks
   * between unrelated concurrent inserts (confirmed live against MySQL
   * 8.4 during this lane's own concurrency testing). A deadlock or
   * lock-wait-timeout here is swallowed, not rethrown: at worst the table
   * temporarily holds a few more rows than `capacity` until a later write
   * successfully trims it, which is a soft resource bound, never a
   * correctness or security guarantee this ledger's callers depend on.
   */
  private async trimIfOverCapacity(): Promise<void> {
    try {
      const { rows: countRows } = await runInTransaction((conn) =>
        execute<{ n: number }>(conn, `SELECT COUNT(*) AS n FROM envelope_message_idempotency_ledger`),
      );
      const total = countRows[0]?.n ?? 0;
      if (total <= this.capacity) return;
      await runInTransaction((conn) =>
        execute(
          conn,
          `DELETE FROM envelope_message_idempotency_ledger
           WHERE id NOT IN (
             SELECT id FROM (
               SELECT id FROM envelope_message_idempotency_ledger
               ORDER BY id DESC
               LIMIT ?
             ) keep
           )`,
          [this.capacity],
        ),
      );
    } catch {
      // Best-effort eviction -- see doc comment above.
    }
  }
}
