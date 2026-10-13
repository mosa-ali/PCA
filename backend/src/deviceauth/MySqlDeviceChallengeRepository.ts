import { execute, runInTransaction } from '../db/pool.js';
import type { ConsumeChallengeResult, DeviceChallengeRepository, VerifiedChallengeSigner } from './DeviceChallengeRepository.js';
import type { ChallengeId, DeviceChallengeRecord } from './types.js';
import { isSupportedChallengeTime } from './policy.js';

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

interface DeviceAuthorityRow {
  device_id: string;
  family_id: string;
  status: 'PAIRING_PENDING' | 'PAIRED' | 'ACTIVE' | 'REVOKED';
}

function snapshotConsumedAt(value: Date): Date | null {
  return isSupportedChallengeTime(value) ? new Date(value.getTime()) : null;
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
   * Locks the challenge, then the family-scoped device, then the exact
   * verified DSK before consuming proof. Device-wide revocation follows the
   * same device-to-key order, so the proof cannot be accepted between device
   * revocation and its key cascade. The challenge remains single-use under
   * concurrent verification; a revoked, substituted, wrong-purpose or
   * wrong-device key cannot consume it.
   */
  async consumeAtomically(
    challengeId: ChallengeId,
    consumedAt: Date,
    verifiedSigner: VerifiedChallengeSigner,
  ): Promise<ConsumeChallengeResult> {
    // Detach the caller's mutable Date before any database await. Invalid or
    // out-of-DATETIME-range server clocks fail closed without touching rows.
    const safeConsumedAt = snapshotConsumedAt(consumedAt);
    if (safeConsumedAt === null) return { outcome: 'EXPIRED' } as const;
    const safeSigner = { ...verifiedSigner };
    return runInTransaction(async (conn) => {
      // Lock challenge first. Device/key revocation never locks a challenge
      // row, so the following device→key order cannot form a cycle with it.
      const current = await execute<DeviceChallengeRow>(
        conn,
        `SELECT * FROM device_challenges WHERE challenge_id = ? FOR UPDATE`,
        [challengeId],
      );
      const row = current.rows[0];
      if (!row) return { outcome: 'NOT_FOUND' } as const;
      if (row.consumed_at) return { outcome: 'ALREADY_CONSUMED' } as const;
      if (safeConsumedAt.getTime() >= row.expires_at.getTime()) return { outcome: 'EXPIRED' } as const;
      if (row.device_id !== safeSigner.deviceId || row.family_id !== safeSigner.familyId) {
        return { outcome: 'SIGNER_KEY_INACTIVE' } as const;
      }

      // Serialize challenge consumption with device-wide revocation. The
      // revocation transaction locks the device before cascading to its keys;
      // rechecking that same row first prevents consuming proof in the window
      // after device status changes but before the DSK row is updated.
      const deviceResult = await execute<DeviceAuthorityRow>(
        conn,
        `SELECT device_id, family_id, status
           FROM devices
          WHERE device_id = ? AND family_id = ?
          FOR UPDATE`,
        [safeSigner.deviceId, safeSigner.familyId],
      );
      const device = deviceResult.rows[0];
      if (!device || device.device_id !== safeSigner.deviceId || device.family_id !== safeSigner.familyId ||
          device.status === 'REVOKED') {
        return { outcome: 'SIGNER_KEY_INACTIVE' } as const;
      }

      const keyResult = await execute<DeviceSigningKeyRow>(
        conn,
        `SELECT device_id, key_id, key_purpose, public_key, status
           FROM device_public_keys WHERE device_id = ? AND key_id = ? FOR UPDATE`,
        [safeSigner.deviceId, safeSigner.keyId],
      );
      const key = keyResult.rows[0];
      if (!key || key.device_id !== safeSigner.deviceId || key.key_id !== safeSigner.keyId
          || key.key_purpose !== 'DSK' || key.public_key !== safeSigner.publicKey || key.status !== 'ACTIVE') {
        return { outcome: 'SIGNER_KEY_INACTIVE' } as const;
      }

      const updated = await execute(
        conn,
        `UPDATE device_challenges
         SET consumed_at = ?
         WHERE challenge_id = ? AND consumed_at IS NULL AND expires_at > ?`,
        [safeConsumedAt, challengeId, safeConsumedAt],
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
