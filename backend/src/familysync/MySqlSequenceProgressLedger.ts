import { execute, runInTransaction } from '../db/pool.js';
import type { OpaqueFamilyId, SenderKeyId } from '../familyenvelope/types.js';
import type { SequenceProgressLedger } from './SequenceProgressLedger.js';

interface SequenceRow {
  last_applied_sequence: number | string;
}

/**
 * Durable, MySQL-backed SequenceProgressLedger -- the PCA-SYNC-DURABILITY-1
 * drop-in replacement for InMemorySequenceProgressLedger. Losing this
 * ledger's state on restart is a genuine ordering-integrity regression for
 * any numeric-sequence-mode sender: SyncCoordinator's gap detection
 * (resolveDependency) treats a null getLastAppliedSequence as "no prior
 * sequence for this sender," so a restart-induced reset would let an
 * already-superseded (older) sequence number sail through as if it were
 * the sender's first-ever message, silently losing the
 * SEQUENCE_NOT_MONOTONIC rejection an attacker replaying a stale-but-
 * validly-signed-at-the-time envelope depends on this ledger to produce.
 *
 * One row per (family_id, sender_key_id) -- bounded by distinct sender
 * population, not message volume, so (like InMemorySequenceProgressLedger)
 * this class implements no eviction; see migration 0002's header.
 *
 * `recordAppliedSequence` mirrors the in-memory version's "only ever
 * advances forward" contract (`if (sequence > current) set`) via an atomic
 * `GREATEST()` UPSERT rather than a read-then-write round trip, so two
 * concurrent recordAppliedSequence calls for the same (family, sender) can
 * never race each other into recording a stale value -- INSERT ...
 * ON DUPLICATE KEY UPDATE with GREATEST(existing, new) is a single atomic
 * statement from MySQL's perspective, stronger than the single-process
 * in-memory Map (which never needed to worry about concurrent writers to
 * begin with).
 */
export class MySqlSequenceProgressLedger implements SequenceProgressLedger {
  async getLastAppliedSequence(familyId: OpaqueFamilyId, senderKeyId: SenderKeyId): Promise<number | null> {
    const { rows } = await runInTransaction((conn) =>
      execute<SequenceRow>(
        conn,
        `SELECT last_applied_sequence FROM sync_sequence_progress_ledger WHERE family_id = ? AND sender_key_id = ?`,
        [familyId, senderKeyId],
      ),
    );
    const row = rows[0];
    if (!row) return null;
    return typeof row.last_applied_sequence === 'string' ? Number(row.last_applied_sequence) : row.last_applied_sequence;
  }

  async recordAppliedSequence(familyId: OpaqueFamilyId, senderKeyId: SenderKeyId, sequence: number): Promise<void> {
    const now = new Date();
    await runInTransaction((conn) =>
      execute(
        conn,
        `INSERT INTO sync_sequence_progress_ledger (family_id, sender_key_id, last_applied_sequence, updated_at)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           last_applied_sequence = GREATEST(last_applied_sequence, VALUES(last_applied_sequence)),
           updated_at = IF(VALUES(last_applied_sequence) > last_applied_sequence, VALUES(updated_at), updated_at)`,
        [familyId, senderKeyId, sequence, now],
      ),
    );
  }
}
