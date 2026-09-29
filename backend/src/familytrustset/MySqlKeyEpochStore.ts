import { execute, runInTransaction } from '../db/pool.js';
import type { CanonicalKeyEpoch, KeyEpochStore } from './KeyEpochStore.js';
import type { OpaqueFamilyId } from './types.js';

interface KeyEpochRow {
  trust_set_epoch: number;
  key_epoch: number;
}

/**
 * Durable, MySQL-backed KeyEpochStore: reads the family's canonical
 * current key epoch off the highest-trustSetEpoch row in
 * `family_trust_set_epochs` (migration 0060). Because the only writer of
 * that table (MySqlTrustSetEpochStore.appendAcceptedEpoch) inserts rows
 * strictly after acceptance and enforces strictly-increasing trust-set
 * epochs per family, ordering by trust_set_epoch uniquely selects the
 * latest ACCEPTED epoch -- this class never derives the value from a
 * candidate or caller-supplied number.
 *
 * Read-only: this class contains no writer of any kind.
 */
export class MySqlKeyEpochStore implements KeyEpochStore {
  async readCanonicalKeyEpoch(familyId: OpaqueFamilyId): Promise<CanonicalKeyEpoch | null> {
    const { rows } = await runInTransaction((conn) =>
      execute<KeyEpochRow>(
        conn,
        `SELECT trust_set_epoch, key_epoch
         FROM family_trust_set_epochs
         WHERE family_id = ?
         ORDER BY trust_set_epoch DESC
         LIMIT 1`,
        [familyId],
      ),
    );
    const row = rows[0];
    return row ? { trustSetEpoch: Number(row.trust_set_epoch), keyEpoch: Number(row.key_epoch) } : null;
  }
}
