import { execute } from '../db/pool.js';
import type { PoolConnection } from 'mysql2/promise';

export const MAX_PROOF_TOMBSTONES_PER_PRUNE = 500;

/** Expire only bounded, already-aged idempotency tombstones; never deletes activation targets or lifecycle facts. */
export class MySqlDevicePolicyProofRetention {
  /** Calls the migration-owned SQL SECURITY DEFINER procedure; general runtime has EXECUTE only, never ledger DELETE. */
  async pruneExpiredTombstones(connection: PoolConnection, batchSize = MAX_PROOF_TOMBSTONES_PER_PRUNE): Promise<number> {
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > MAX_PROOF_TOMBSTONES_PER_PRUNE) {
      throw new RangeError('proof_tombstone_prune_batch_out_of_range');
    }
    await execute(connection,
      `CALL pca_prune_expired_device_policy_proofs(?, @pca_pruned_proof_tombstones)`, [batchSize]);
    const result = await execute<{ deleted_count: number | string }>(connection,
      `SELECT @pca_pruned_proof_tombstones AS deleted_count`);
    return Number(result.rows[0]?.deleted_count ?? 0);
  }
}
