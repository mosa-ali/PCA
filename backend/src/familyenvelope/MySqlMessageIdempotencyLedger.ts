import { execute, isDuplicateEntry, runInTransaction } from '../db/pool.js';
import type { MessageId, OpaqueFamilyId } from './types.js';
import type { MessageIdempotencyLedger, RecordAcceptedResult } from './MessageIdempotencyLedger.js';
import { MESSAGE_IDEMPOTENCY_LEDGER_CAPACITY } from './policy.js';

interface IdempotencyRow {
  canonical_bytes: Buffer;
}

const MAX_CONFLICT_READBACK_ATTEMPTS = 3;

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
 * PCA-17C RUNTIME-SYNC-ACCEPTANCE-INTEGRITY -- TWO independent fixes in
 * this class:
 *
 * (1) FAMILY SCOPING: the unique key is now (family_id, message_id), not
 * message_id alone (migration 0004) -- `family_id` is ALWAYS the caller's
 * authoritative, session-derived family identity (see
 * FamilyEnvelopeVerifier's EnvelopeAcceptanceContext.familyId doc
 * comment), never envelope.familyId. Two different families can no longer
 * share idempotency/conflict state even if their messageId values ever
 * collide.
 *
 * (2) CROSS-INSTANCE ATOMICITY (the PCA11_ORDERING_CONCURRENCY gap
 * SyncCoordinator.ts's own doc comment names as explicitly out of its
 * scope, since its chainByKey serialization only ever protects ONE
 * process): `recordAccepted` previously used an unconditional
 * `INSERT ... ON DUPLICATE KEY UPDATE canonical_bytes = VALUES(...)`,
 * meaning two DIFFERENT backend processes racing to accept the SAME
 * messageId with DIFFERENT canonical content would both "succeed," and
 * whichever write landed last would silently overwrite the other's
 * content with no conflict ever surfaced -- the exact MESSAGE_ID_CONFLICT
 * rejection evaluateEnvelope's own doc comment says must never be
 * bypassed.
 *
 * The fix: `recordAccepted` now attempts a PLAIN INSERT (no
 * ON DUPLICATE KEY UPDATE). MySQL/InnoDB's unique index on
 * (family_id, message_id) is the actual arbiter here -- it is enforced
 * engine-side across every connection/process sharing this database, which
 * is a genuine cross-instance atomic primitive this class leans on rather
 * than trying to reimplement in application code. Exactly one concurrent
 * INSERT for a given (family_id, message_id) can ever succeed; every other
 * concurrent INSERT for that same key blocks on the unique index's
 * row/gap lock until the winner's transaction resolves, then itself either
 * succeeds (if the winner rolled back) or fails with ER_DUP_ENTRY (if the
 * winner committed -- the ordinary case). A caller that loses the race
 * catches that duplicate-key error and, in a FRESH transaction (this pool
 * runs at READ COMMITTED -- see db/pool.ts's own doc comment on why -- so
 * this fresh read reliably observes the winner's just-committed row, never
 * a stale snapshot), reads back the winning row and compares its
 * canonical_bytes: identical content resolves as 'already-idempotent' (a
 * legitimate concurrent redelivery, both callers converge on success);
 * different content resolves as 'conflict' (MESSAGE_ID_CONFLICT, surfaced
 * to the loser, never silently absorbed).
 *
 * `canonical_bytes` is stored as MEDIUMBLOB (opaque bytes) even though the
 * in-memory ledger holds it as a plain JS string -- canonicalizeEnvelope's
 * output is UTF-8-safe text, so the round trip (`Buffer.from(str, 'utf8')`
 * in, `.toString('utf8')` out) is lossless; storing it as a BLOB rather
 * than VARCHAR/TEXT matches this schema's established privacy posture for
 * every other opaque/signed-content column (see migration 0002's header).
 */
export class MySqlMessageIdempotencyLedger implements MessageIdempotencyLedger {
  constructor(private readonly capacity: number = MESSAGE_IDEMPOTENCY_LEDGER_CAPACITY) {}

  async getAcceptedCanonicalBytes(familyId: OpaqueFamilyId, messageId: MessageId): Promise<string | null> {
    const { rows } = await runInTransaction((conn) =>
      execute<IdempotencyRow>(
        conn,
        `SELECT canonical_bytes FROM envelope_message_idempotency_ledger WHERE family_id = ? AND message_id = ?`,
        [familyId, messageId],
      ),
    );
    const row = rows[0];
    return row ? row.canonical_bytes.toString('utf8') : null;
  }

  async recordAccepted(familyId: OpaqueFamilyId, messageId: MessageId, canonicalBytes: string): Promise<RecordAcceptedResult> {
    if (this.capacity <= 0) return { outcome: 'recorded' };
    const bytes = Buffer.from(canonicalBytes, 'utf8');

    for (let attempt = 0; attempt < MAX_CONFLICT_READBACK_ATTEMPTS; attempt += 1) {
      try {
        const now = new Date();
        // The INSERT is its own short transaction -- correctness (durably,
        // atomically recording this (family, messageId)'s canonical bytes,
        // or discovering a genuine conflict) must never be blocked or
        // failed by eviction bookkeeping. Eviction is a resource-abuse
        // ceiling, not a security control (see this class's own doc
        // comment and migration 0002's header), so it is handled entirely
        // separately below, only after a successful insert.
        await runInTransaction((conn) =>
          execute(
            conn,
            `INSERT INTO envelope_message_idempotency_ledger (family_id, message_id, canonical_bytes, recorded_at)
             VALUES (?, ?, ?, ?)`,
            [familyId, messageId, bytes, now],
          ),
        );
        await this.trimIfOverCapacity();
        return { outcome: 'recorded' };
      } catch (error) {
        if (!isDuplicateEntry(error)) throw error;
        // Lost the race for this (family_id, message_id) -- a concurrent
        // caller's INSERT already committed. Read its winning row back (a
        // FRESH transaction, so READ COMMITTED guarantees this observes
        // the just-committed write) and compare content.
        const { rows } = await runInTransaction((conn) =>
          execute<IdempotencyRow>(
            conn,
            `SELECT canonical_bytes FROM envelope_message_idempotency_ledger WHERE family_id = ? AND message_id = ?`,
            [familyId, messageId],
          ),
        );
        const existing = rows[0];
        if (!existing) {
          // Extremely unlikely TOCTOU: the winning row was evicted (global
          // capacity trim) between our failed INSERT and this SELECT.
          // Retry the insert from scratch -- bounded by
          // MAX_CONFLICT_READBACK_ATTEMPTS so this can never spin forever.
          continue;
        }
        const existingBytes = existing.canonical_bytes.toString('utf8');
        return existingBytes === canonicalBytes ? { outcome: 'already-idempotent' } : { outcome: 'conflict' };
      }
    }
    // Exhausted retries under a pathological eviction race -- fail closed
    // as a conflict rather than silently accepting unrecorded content.
    return { outcome: 'conflict' };
  }

  /**
   * PCA-17E ACCEPTANCE-ORDERING: compensating undo for a row THIS caller
   * just won via `recordAccepted` returning `{ outcome: 'recorded' }` --
   * see MessageIdempotencyLedger.ts's doc comment on why this must only
   * ever target a row this exact call just won. A plain DELETE keyed by
   * (family_id, message_id); best-effort is not appropriate here for the
   * same reason as MySqlReplayLedger.releaseClaim -- a failed release would
   * leave a rejected envelope's messageId permanently, incorrectly marked
   * "accepted."
   */
  async releaseAccepted(familyId: OpaqueFamilyId, messageId: MessageId): Promise<void> {
    await runInTransaction((conn) =>
      execute(conn, `DELETE FROM envelope_message_idempotency_ledger WHERE family_id = ? AND message_id = ?`, [familyId, messageId]),
    );
  }

  /**
   * Bounded GLOBAL eviction: keep only the newest `capacity` rows (by
   * insertion order / id), deleting any older overflow -- deliberately
   * left GLOBAL, not narrowed to per-family, by this lane; see migration
   * 0004's header for why (this dimension was always a resource-abuse
   * ceiling, never a security control -- the security property is the
   * per-family UNIQUE key, unaffected by eviction scope).
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
