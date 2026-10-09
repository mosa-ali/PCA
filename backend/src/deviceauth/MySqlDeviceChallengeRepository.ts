import { execute, runInTransaction } from '../db/pool.js';
import type { ConsumeChallengeResult, DeviceChallengeRepository, VerifiedChallengeSigner } from './DeviceChallengeRepository.js';
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

interface DeviceSigningKeyRow {
  device_id: string;
  key_id: string;
  key_purpose: 'DSK' | 'DEK';
  public_key: string;
  status: 'ACTIVE' | 'REVOKED';
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
   * Locks the exact verified DSK before consuming the challenge, so key
   * revocation and proof acceptance serialize on the same InnoDB row. The
   * challenge remains single-use under concurrent verification; a revoked,
   * substituted, wrong-purpose or wrong-device key cannot consume it.
   */
  async consumeAtomically(
    challengeId: ChallengeId,
    consumedAt: Date,
    verifiedSigner: VerifiedChallengeSigner,
  ): Promise<ConsumeChallengeResult> {
    return runInTransaction(async (conn) => {
      // Lock challenge first, then the exact key. Key revocation never locks
      // a challenge row, so this order cannot form a cycle with revocation.
      const current = await execute<DeviceChallengeRow>(
        conn,
        `SELECT * FROM device_challenges WHERE challenge_id = ? FOR UPDATE`,
        [challengeId],
      );
      const row = current.rows[0];
      if (!row) return { outcome: 'NOT_FOUND' } as const;
      if (row.consumed_at) return { outcome: 'ALREADY_CONSUMED' } as const;
      if (consumedAt.getTime() >= row.expires_at.getTime()) return { outcome: 'EXPIRED' } as const;
      if (row.device_id !== verifiedSigner.deviceId || row.family_id !== verifiedSigner.familyId) {
        return { outcome: 'SIGNER_KEY_INACTIVE' } as const;
      }

      const keyResult = await execute<DeviceSigningKeyRow>(
        conn,
        `SELECT device_id, key_id, key_purpose, public_key, status
           FROM device_public_keys WHERE device_id = ? AND key_id = ? FOR UPDATE`,
        [verifiedSigner.deviceId, verifiedSigner.keyId],
      );
      const key = keyResult.rows[0];
      if (!key || key.device_id !== verifiedSigner.deviceId || key.key_id !== verifiedSigner.keyId
          || key.key_purpose !== 'DSK' || key.public_key !== verifiedSigner.publicKey || key.status !== 'ACTIVE') {
        return { outcome: 'SIGNER_KEY_INACTIVE' } as const;
      }

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
      // Both rows remain locked, so reaching this branch means the guarded
      // update did not match because the database expiry boundary won.
      return { outcome: 'EXPIRED' } as const;
    });
  }
}
