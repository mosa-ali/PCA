import { execute, isDuplicateEntry, runInTransaction } from '../db/pool.js';
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

export class MySqlRecoveryRepository implements RecoveryRepository {
  async getEnvelope(familyId: OpaqueFamilyId): Promise<RecoveryEnvelopeRecord | null> {
    const { rows } = await runInTransaction((conn) =>
      execute<RecoveryRow>(conn, `SELECT * FROM recovery_envelopes WHERE family_id = ?`, [familyId]),
    );
    return rows[0] ? mapRow(rows[0]) : null;
  }

  /**
   * Optimistic concurrency as a single atomic statement per branch (INSERT,
   * relying on the primary key to reject a concurrent creation, for the
   * initial write; UPDATE ... WHERE version = ? for replacement) rather
   * than a read-then-write pair -- InnoDB row locking means concurrent
   * writers targeting the same expectedVersion cannot both succeed.
   */
  async storeEnvelope(
    familyId: OpaqueFamilyId,
    ciphertext: Buffer,
    expectedVersion: number,
    now: Date,
  ): Promise<StoreEnvelopeResult> {
    return runInTransaction(async (conn) => {
      if (expectedVersion === 0) {
        try {
          await execute(
            conn,
            `INSERT INTO recovery_envelopes (family_id, ciphertext, version, created_at, updated_at)
             VALUES (?, ?, 1, ?, ?)`,
            [familyId, ciphertext, now, now],
          );
          const inserted = await execute<RecoveryRow>(conn, `SELECT * FROM recovery_envelopes WHERE family_id = ?`, [
            familyId,
          ]);
          return { outcome: 'STORED', record: mapRow(inserted.rows[0]!) };
        } catch (error) {
          if (!isDuplicateEntry(error)) throw error;
        }
      } else {
        const updated = await execute(
          conn,
          `UPDATE recovery_envelopes SET ciphertext = ?, version = version + 1, updated_at = ?
           WHERE family_id = ? AND version = ?`,
          [ciphertext, now, familyId, expectedVersion],
        );
        if (updated.rowCount > 0) {
          const reread = await execute<RecoveryRow>(conn, `SELECT * FROM recovery_envelopes WHERE family_id = ?`, [
            familyId,
          ]);
          return { outcome: 'STORED', record: mapRow(reread.rows[0]!) };
        }
      }

      const current = await execute<RecoveryRow>(conn, `SELECT version FROM recovery_envelopes WHERE family_id = ?`, [
        familyId,
      ]);
      return { outcome: 'VERSION_MISMATCH', currentVersion: current.rows[0]?.version ?? null };
    });
  }

  async deleteEnvelope(familyId: OpaqueFamilyId): Promise<DeleteEnvelopeResult> {
    const { rowCount } = await runInTransaction((conn) =>
      execute(conn, `DELETE FROM recovery_envelopes WHERE family_id = ?`, [familyId]),
    );
    return rowCount > 0 ? { outcome: 'DELETED' } : { outcome: 'NOT_FOUND' };
  }
}
