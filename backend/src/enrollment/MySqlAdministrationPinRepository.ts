import { execute, runInTransaction } from '../db/pool.js';
import type {
  AdministrationPinRecord,
  AdministrationPinRepository,
} from './AdministrationPinService.js';

interface AdministrationPinRow {
  family_id: string;
  salt_b64: string;
  verifier_b64: string;
  failed_attempts: number | string;
  locked_until: Date | string | null;
  updated_at: Date | string;
}

function toUtcIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toRecord(row: AdministrationPinRow): AdministrationPinRecord {
  return {
    familyId: row.family_id,
    saltB64: row.salt_b64,
    verifierB64: row.verifier_b64,
    failedAttempts: Number(row.failed_attempts),
    lockedUntilUtc: row.locked_until === null ? null : toUtcIso(row.locked_until),
    updatedAtUtc: toUtcIso(row.updated_at),
  };
}

/** Durable verifier-only store for PCA-ADD-ENR-012; no raw PIN reaches SQL. */
export class MySqlAdministrationPinRepository implements AdministrationPinRepository {
  async get(familyId: string): Promise<AdministrationPinRecord | null> {
    const { rows } = await runInTransaction((conn) =>
      execute<AdministrationPinRow>(
        conn,
        `SELECT family_id, salt_b64, verifier_b64, failed_attempts, locked_until, updated_at
         FROM enrollment_administration_verifiers
         WHERE family_id = ?`,
        [familyId],
      ),
    );
    return rows[0] ? toRecord(rows[0]) : null;
  }

  async upsert(record: AdministrationPinRecord): Promise<void> {
    await runInTransaction((conn) =>
      execute(
        conn,
        `INSERT INTO enrollment_administration_verifiers
           (family_id, salt_b64, verifier_b64, failed_attempts, locked_until, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           salt_b64 = VALUES(salt_b64),
           verifier_b64 = VALUES(verifier_b64),
           failed_attempts = VALUES(failed_attempts),
           locked_until = VALUES(locked_until),
           updated_at = VALUES(updated_at)`,
        [
          record.familyId,
          record.saltB64,
          record.verifierB64,
          record.failedAttempts,
          record.lockedUntilUtc === null ? null : new Date(record.lockedUntilUtc),
          new Date(record.updatedAtUtc),
        ],
      ),
    );
  }

  async clearFailures(familyId: string): Promise<void> {
    await runInTransaction((conn) =>
      execute(
        conn,
        `UPDATE enrollment_administration_verifiers
         SET failed_attempts = 0, locked_until = NULL, updated_at = CURRENT_TIMESTAMP(3)
         WHERE family_id = ?`,
        [familyId],
      ),
    );
  }

  /** Serializes failure increments per family so concurrent verifications cannot lose a failure. */
  async recordFailure(
    familyId: string,
    now: Date,
    lockoutThreshold: number,
    lockoutMs: number,
  ): Promise<{ failedAttempts: number; lockedUntilUtc: string | null }> {
    return runInTransaction(async (conn) => {
      const { rows } = await execute<AdministrationPinRow>(
        conn,
        `SELECT family_id, salt_b64, verifier_b64, failed_attempts, locked_until, updated_at
         FROM enrollment_administration_verifiers
         WHERE family_id = ?
         FOR UPDATE`,
        [familyId],
      );
      const row = rows[0];
      if (!row) return { failedAttempts: 0, lockedUntilUtc: null };

      const failedAttempts = Number(row.failed_attempts) + 1;
      const lockedUntil = failedAttempts >= lockoutThreshold
        ? new Date(now.getTime() + lockoutMs)
        : null;
      await execute(
        conn,
        `UPDATE enrollment_administration_verifiers
         SET failed_attempts = ?, locked_until = ?, updated_at = ?
         WHERE family_id = ?`,
        [failedAttempts, lockedUntil, now, familyId],
      );
      return {
        failedAttempts,
        lockedUntilUtc: lockedUntil === null ? null : lockedUntil.toISOString(),
      };
    });
  }
}
