import { runInTransaction } from '../db/pool.js';
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

export class PostgresDeviceChallengeRepository implements DeviceChallengeRepository {
  async create(record: DeviceChallengeRecord): Promise<void> {
    await runInTransaction(async (client) => {
      await client.query(
        `INSERT INTO device_challenges (challenge_id, device_id, family_id, nonce, created_at, expires_at, consumed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [record.challengeId, record.deviceId, record.familyId, record.nonce, record.createdAt, record.expiresAt, record.consumedAt],
      );
    });
  }

  async findById(challengeId: ChallengeId): Promise<DeviceChallengeRecord | null> {
    const { rows } = await runInTransaction((client) =>
      client.query<DeviceChallengeRow>(`SELECT * FROM device_challenges WHERE challenge_id = $1`, [challengeId]),
    );
    return rows[0] ? mapRow(rows[0]) : null;
  }

  /**
   * Single atomic UPDATE guarded by consumed_at IS NULL AND not-yet-expired,
   * not a read-then-write pair -- mirrors PostgresInvitationRepository's
   * redeemAtomically. Under concurrent verification attempts (including a
   * replayed, genuinely-valid signature), Postgres row-level locking
   * serializes the competing UPDATEs; every loser's WHERE clause
   * re-evaluates against the winner's already-committed row and matches
   * zero rows, so it falls through to the disambiguating SELECT rather than
   * double-consuming.
   */
  async consumeAtomically(challengeId: ChallengeId, consumedAt: Date): Promise<ConsumeChallengeResult> {
    return runInTransaction(async (client) => {
      const updated = await client.query<DeviceChallengeRow>(
        `UPDATE device_challenges
         SET consumed_at = $2
         WHERE challenge_id = $1 AND consumed_at IS NULL AND expires_at > $2
         RETURNING *`,
        [challengeId, consumedAt],
      );
      if (updated.rows[0]) return { outcome: 'CONSUMED', challenge: mapRow(updated.rows[0]) };

      const current = await client.query<DeviceChallengeRow>(
        `SELECT * FROM device_challenges WHERE challenge_id = $1`,
        [challengeId],
      );
      const row = current.rows[0];
      if (!row) return { outcome: 'NOT_FOUND' };
      if (row.consumed_at) return { outcome: 'ALREADY_CONSUMED' };
      return { outcome: 'EXPIRED' };
    });
  }
}
