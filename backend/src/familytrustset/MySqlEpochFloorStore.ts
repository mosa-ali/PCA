import { execute, runInTransaction } from '../db/pool.js';
import type { EpochFloorStore, FamilyEpochFloors } from './EpochFloorStore.js';
import type { OpaqueFamilyId } from './types.js';

interface FloorRow {
  minimum_accepted_trust_set_epoch: number;
  minimum_accepted_key_epoch: number;
}

/**
 * Durable, MySQL-backed EpochFloorStore: reads the per-family acceptance
 * floors from `family_epoch_floors` (migration 0060). Because the only
 * writer (MySqlTrustSetEpochStore.appendAcceptedEpoch) advances these
 * floors atomically with the epoch insert, a floor value can never point
 * beyond -- or behind -- the accepted epoch history it was derived from.
 *
 * Read-only: this class contains no writer of any kind.
 */
export class MySqlEpochFloorStore implements EpochFloorStore {
  async readFloors(familyId: OpaqueFamilyId): Promise<FamilyEpochFloors | null> {
    const { rows } = await runInTransaction((conn) =>
      execute<FloorRow>(
        conn,
        `SELECT minimum_accepted_trust_set_epoch, minimum_accepted_key_epoch
         FROM family_epoch_floors
         WHERE family_id = ?`,
        [familyId],
      ),
    );
    const row = rows[0];
    return row
      ? {
          minimumAcceptedTrustSetEpoch: Number(row.minimum_accepted_trust_set_epoch),
          minimumAcceptedKeyEpoch: Number(row.minimum_accepted_key_epoch),
        }
      : null;
  }
}
