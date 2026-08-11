import { execute, runInTransaction } from '../db/pool.js';
import type { ConsumeChallengeResult, DeviceChallengeRepository } from './DeviceChallengeRepository.js';
import type { ChallengeId, DeviceChallengeRecord } from './types.js';

interface DeviceChallengeRow {
  challenge_id: string;
  device_id: string;
  family_id: string;
  nonce: string;
  created_at: Date;
  expires_at: Date;
  consumed_at: Date | null;
}

function mapRow(row: DeviceChallengeRow): DeviceChallengeRecord {
  return {
    challengeId: row.challenge_id,
    deviceId: row.device_id,
    familyId: row.family_id,
    nonce: row.nonce,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    consumedAt: row.consumed_at,
  };
}

export class MySqlDeviceChallengeRepository implements DeviceChallengeRepository {
  async create(record: DeviceChallengeRecord): Promise<void> {
    await runInTransaction(async (conn) => {
      await execute(
        conn,
        `INSERT INTO device_challenges (challenge_id, device_id, family_id, nonce, created_at, expires_at, consumed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [record.challengeId, record.deviceId, record.familyId, record.nonce, record.createdAt, record.expiresAt, record.consumedAt],
      );
    });
  }

  async findById(challengeId: ChallengeId): Promise<DeviceChallengeRecord | null> {
    const { rows } = await runInTransaction((conn) =>
      execute<DeviceChallengeRow>(conn, `SELECT * FROM device_challenges WHERE challenge_id = ?`, [challengeId]),
    );
    return rows[0] ? mapRow(rows[0]) : null;
  }

  /**
   * Single atomic UPDATE guarded by consumed_at IS NULL AND not-yet-expired,
   * not a read-then-write pair -- mirrors MySqlInvitationRepository's
   * redeemAtomically. Under concurrent verification attempts (including a
   * replayed, genuinely-valid signature), InnoDB row-level locking
   * serializes the competing UPDATEs; every loser's WHERE clause
   * re-evaluates against the winner's already-committed row and matches
   * zero rows, so it falls through to the disambiguating SELECT rather than
   * double-consuming.
   */
  async consumeAtomically(challengeId: ChallengeId, consumedAt: Date): Promise<ConsumeChallengeResult> {
    return runInTransaction(async (conn) => {
      const updated = await execute(
        conn,
        `UPDATE device_challenges
         SET consumed_at = ?
         WHERE challenge_id = ? AND consumed_at IS NULL AND expires_at > ?`,
        [consumedAt, challengeId, consumedAt],
      );
      if (updated.rowCount > 0) {
        const reread = await execute<DeviceChallengeRow>(conn, `SELECT * FROM device_challenges WHERE challenge_id = ?`, [
          challengeId,
        ]);
        return { outcome: 'CONSUMED', challenge: mapRow(reread.rows[0]!) };
      }

      const current = await execute<DeviceChallengeRow>(conn, `SELECT * FROM device_challenges WHERE challenge_id = ?`, [
        challengeId,
      ]);
      const row = current.rows[0];
      if (!row) return { outcome: 'NOT_FOUND' };
      if (row.consumed_at) return { outcome: 'ALREADY_CONSUMED' };
      return { outcome: 'EXPIRED' };
    });
  }
}
