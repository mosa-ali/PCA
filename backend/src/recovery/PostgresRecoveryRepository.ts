import { runInTransaction } from '../db/pool.js';
import type { DeleteEnvelopeResult, RecoveryRepository, StoreEnvelopeResult } from './RecoveryRepository.js';
import type { OpaqueFamilyId, RecoveryEnvelopeRecord } from './types.js';

interface RecoveryRow {
  family_id: string;
  ciphertext: Buffer;
  version: number;
  created_at: Date;
  updated_at: Date;
}

function mapRow(row: RecoveryRow): RecoveryEnvelopeRecord {
  return {
    familyId: row.family_id,
    ciphertext: row.ciphertext,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class PostgresRecoveryRepository implements RecoveryRepository {
  async getEnvelope(familyId: OpaqueFamilyId): Promise<RecoveryEnvelopeRecord | null> {
    const { rows } = await runInTransaction((client) =>
      client.query<RecoveryRow>(`SELECT * FROM recovery_envelopes WHERE family_id = $1`, [familyId]),
    );
    return rows[0] ? mapRow(rows[0]) : null;
  }

  /**
   * Optimistic concurrency as a single atomic statement per branch (INSERT
   * ... ON CONFLICT DO NOTHING for creation, UPDATE ... WHERE version = $n
   * for replacement) rather than a read-then-write pair -- Postgres row
   * locking means concurrent writers targeting the same expectedVersion
   * cannot both succeed.
   */
  async storeEnvelope(
    familyId: OpaqueFamilyId,
    ciphertext: Buffer,
    expectedVersion: number,
    now: Date,
  ): Promise<StoreEnvelopeResult> {
    return runInTransaction(async (client) => {
      if (expectedVersion === 0) {
        const inserted = await client.query<RecoveryRow>(
          `INSERT INTO recovery_envelopes (family_id, ciphertext, version, created_at, updated_at)
           VALUES ($1, $2, 1, $3, $3)
           ON CONFLICT (family_id) DO NOTHING
           RETURNING *`,
          [familyId, ciphertext, now],
        );
        if (inserted.rows[0]) return { outcome: 'STORED', record: mapRow(inserted.rows[0]) };
      } else {
        const updated = await client.query<RecoveryRow>(
          `UPDATE recovery_envelopes SET ciphertext = $2, version = version + 1, updated_at = $4
           WHERE family_id = $1 AND version = $3
           RETURNING *`,
          [familyId, ciphertext, expectedVersion, now],
        );
        if (updated.rows[0]) return { outcome: 'STORED', record: mapRow(updated.rows[0]) };
      }

      const current = await client.query<RecoveryRow>(`SELECT version FROM recovery_envelopes WHERE family_id = $1`, [
        familyId,
      ]);
      return { outcome: 'VERSION_MISMATCH', currentVersion: current.rows[0]?.version ?? null };
    });
  }

  async deleteEnvelope(familyId: OpaqueFamilyId): Promise<DeleteEnvelopeResult> {
    const { rowCount } = await runInTransaction((client) =>
      client.query(`DELETE FROM recovery_envelopes WHERE family_id = $1`, [familyId]),
    );
    return rowCount && rowCount > 0 ? { outcome: 'DELETED' } : { outcome: 'NOT_FOUND' };
  }
}
