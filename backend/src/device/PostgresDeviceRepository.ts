import { isUniqueViolation, runInTransaction, SoftFailure } from '../db/pool.js';
import type {
  AddKeyResult,
  ConfirmPairingResult,
  CreateDeviceResult,
  DeviceRepository,
  RevokeDeviceResult,
  RevokeKeyResult,
} from './DeviceRepository.js';
import type { DeviceId, DeviceKeyId, DeviceKeyRecord, DeviceRecord, OpaqueFamilyId } from './types.js';

interface DeviceRow {
  device_id: string;
  family_id: string;
  platform: DeviceRecord['platform'];
  status: DeviceRecord['status'];
  created_at: Date;
  revoked_at: Date | null;
  paired_at: Date | null;
  paired_by_account_id: string | null;
}

interface DeviceKeyRow {
  device_id: string;
  key_id: string;
  key_purpose: DeviceKeyRecord['keyPurpose'];
  public_key: string;
  status: DeviceKeyRecord['status'];
  created_at: Date;
  revoked_at: Date | null;
}

function mapDevice(row: DeviceRow): DeviceRecord {
  return {
    deviceId: row.device_id,
    familyId: row.family_id,
    platform: row.platform,
    status: row.status,
    createdAt: row.created_at,
    revokedAt: row.revoked_at,
    pairedAt: row.paired_at,
    pairedByAccountId: row.paired_by_account_id,
  };
}

function mapKey(row: DeviceKeyRow): DeviceKeyRecord {
  return {
    deviceId: row.device_id,
    keyId: row.key_id,
    keyPurpose: row.key_purpose,
    publicKey: row.public_key,
    status: row.status,
    createdAt: row.created_at,
    revokedAt: row.revoked_at,
  };
}

type DeviceSoftCode = 'DEVICE_NOT_FOUND' | 'DEVICE_REVOKED' | 'DUPLICATE_KEY' | 'KEY_NOT_FOUND' | 'INVALID_STATE';

export class PostgresDeviceRepository implements DeviceRepository {
  async createDeviceWithKey(device: DeviceRecord, key: DeviceKeyRecord): Promise<CreateDeviceResult> {
    try {
      return await runInTransaction(async (client) => {
        await client.query(
          `INSERT INTO devices (device_id, family_id, platform, status, created_at, revoked_at, paired_at, paired_by_account_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            device.deviceId,
            device.familyId,
            device.platform,
            device.status,
            device.createdAt,
            device.revokedAt,
            device.pairedAt,
            device.pairedByAccountId,
          ],
        );
        try {
          await client.query(
            `INSERT INTO device_public_keys (device_id, key_id, key_purpose, public_key, status, created_at, revoked_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [key.deviceId, key.keyId, key.keyPurpose, key.publicKey, key.status, key.createdAt, key.revokedAt],
          );
        } catch (error) {
          if (isUniqueViolation(error)) throw new SoftFailure<DeviceSoftCode>('DUPLICATE_KEY');
          throw error;
        }
        return { outcome: 'CREATED', device, key } as const;
      });
    } catch (error) {
      if (error instanceof SoftFailure) return { outcome: 'DUPLICATE_KEY' };
      throw error;
    }
  }

  async findDeviceForFamily(familyId: OpaqueFamilyId, deviceId: DeviceId): Promise<DeviceRecord | null> {
    const { rows } = await runInTransaction((client) =>
      client.query<DeviceRow>(`SELECT * FROM devices WHERE device_id = $1 AND family_id = $2`, [deviceId, familyId]),
    );
    return rows[0] ? mapDevice(rows[0]) : null;
  }

  async findDeviceUnscoped(deviceId: DeviceId): Promise<DeviceRecord | null> {
    const { rows } = await runInTransaction((client) =>
      client.query<DeviceRow>(`SELECT * FROM devices WHERE device_id = $1`, [deviceId]),
    );
    return rows[0] ? mapDevice(rows[0]) : null;
  }

  /** Device revocation and cascading key revocation as ONE transaction, not an application-level loop. */
  async revokeDeviceAndKeysAtomically(
    familyId: OpaqueFamilyId,
    deviceId: DeviceId,
    revokedAt: Date,
  ): Promise<RevokeDeviceResult> {
    try {
      return await runInTransaction(async (client) => {
        const deviceResult = await client.query<DeviceRow>(
          `UPDATE devices SET status = 'REVOKED', revoked_at = $3
           WHERE device_id = $1 AND family_id = $2 AND status != 'REVOKED'
           RETURNING *`,
          [deviceId, familyId, revokedAt],
        );
        let deviceRow = deviceResult.rows[0];
        if (!deviceRow) {
          // Either unknown, or already revoked -- the status guard above
          // means "already revoked" falls through here too, so the FIRST
          // revocation's timestamp stays authoritative rather than being
          // silently rewritten by a later, redundant revoke call.
          const existing = await client.query<DeviceRow>(
            `SELECT * FROM devices WHERE device_id = $1 AND family_id = $2`,
            [deviceId, familyId],
          );
          if (!existing.rows[0]) throw new SoftFailure<DeviceSoftCode>('DEVICE_NOT_FOUND');
          deviceRow = existing.rows[0];
        }

        // AND status = 'ACTIVE' already makes this idempotent on repeat
        // calls -- an already-revoked key is never re-touched, so its
        // original revoked_at is preserved automatically.
        await client.query(
          `UPDATE device_public_keys SET status = 'REVOKED', revoked_at = $2
           WHERE device_id = $1 AND status = 'ACTIVE'`,
          [deviceId, revokedAt],
        );
        const keysResult = await client.query<DeviceKeyRow>(
          `SELECT * FROM device_public_keys WHERE device_id = $1`,
          [deviceId],
        );
        return { outcome: 'REVOKED', device: mapDevice(deviceRow), keys: keysResult.rows.map(mapKey) } as const;
      });
    } catch (error) {
      if (error instanceof SoftFailure) return { outcome: 'DEVICE_NOT_FOUND' };
      throw error;
    }
  }

  async addKeyAtomically(familyId: OpaqueFamilyId, record: DeviceKeyRecord): Promise<AddKeyResult> {
    try {
      return await runInTransaction(async (client) => {
        const deviceResult = await client.query<DeviceRow>(
          `SELECT * FROM devices WHERE device_id = $1 AND family_id = $2 FOR UPDATE`,
          [record.deviceId, familyId],
        );
        const deviceRow = deviceResult.rows[0];
        if (!deviceRow) throw new SoftFailure<DeviceSoftCode>('DEVICE_NOT_FOUND');
        if (deviceRow.status === 'REVOKED') throw new SoftFailure<DeviceSoftCode>('DEVICE_REVOKED');

        try {
          await client.query(
            `INSERT INTO device_public_keys (device_id, key_id, key_purpose, public_key, status, created_at, revoked_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [record.deviceId, record.keyId, record.keyPurpose, record.publicKey, record.status, record.createdAt, record.revokedAt],
          );
        } catch (error) {
          if (isUniqueViolation(error)) throw new SoftFailure<DeviceSoftCode>('DUPLICATE_KEY');
          throw error;
        }
        return { outcome: 'ADDED', key: record } as const;
      });
    } catch (error) {
      if (error instanceof SoftFailure) {
        return { outcome: error.outcome } as AddKeyResult;
      }
      throw error;
    }
  }

  async findKeysByDeviceForFamily(familyId: OpaqueFamilyId, deviceId: DeviceId): Promise<DeviceKeyRecord[]> {
    return runInTransaction(async (client) => {
      const device = await client.query(`SELECT 1 FROM devices WHERE device_id = $1 AND family_id = $2`, [
        deviceId,
        familyId,
      ]);
      if (device.rowCount === 0) return [];
      const keys = await client.query<DeviceKeyRow>(`SELECT * FROM device_public_keys WHERE device_id = $1`, [
        deviceId,
      ]);
      return keys.rows.map(mapKey);
    });
  }

  async revokeKeyForFamily(
    familyId: OpaqueFamilyId,
    deviceId: DeviceId,
    keyId: DeviceKeyId,
    revokedAt: Date,
  ): Promise<RevokeKeyResult> {
    try {
      return await runInTransaction(async (client) => {
        const device = await client.query(`SELECT 1 FROM devices WHERE device_id = $1 AND family_id = $2`, [
          deviceId,
          familyId,
        ]);
        if (device.rowCount === 0) throw new SoftFailure<DeviceSoftCode>('DEVICE_NOT_FOUND');

        const updated = await client.query<DeviceKeyRow>(
          `UPDATE device_public_keys SET status = 'REVOKED', revoked_at = $3
           WHERE device_id = $1 AND key_id = $2 AND status != 'REVOKED'
           RETURNING *`,
          [deviceId, keyId, revokedAt],
        );
        if (updated.rows[0]) return { outcome: 'REVOKED', key: mapKey(updated.rows[0]) } as const;

        const existing = await client.query<DeviceKeyRow>(
          `SELECT * FROM device_public_keys WHERE device_id = $1 AND key_id = $2`,
          [deviceId, keyId],
        );
        if (!existing.rows[0]) throw new SoftFailure<DeviceSoftCode>('KEY_NOT_FOUND');
        // Already revoked -- idempotent success, first revocation's timestamp preserved.
        return { outcome: 'REVOKED', key: mapKey(existing.rows[0]) } as const;
      });
    } catch (error) {
      if (error instanceof SoftFailure) {
        return { outcome: error.outcome } as RevokeKeyResult;
      }
      throw error;
    }
  }

  async confirmPairing(
    familyId: OpaqueFamilyId,
    deviceId: DeviceId,
    confirmedByAccountId: string,
    confirmedAt: Date,
  ): Promise<ConfirmPairingResult> {
    try {
      return await runInTransaction(async (client) => {
        const updated = await client.query<DeviceRow>(
          `UPDATE devices SET status = 'PAIRED', paired_at = $3, paired_by_account_id = $4
           WHERE device_id = $1 AND family_id = $2 AND status = 'PAIRING_PENDING'
           RETURNING *`,
          [deviceId, familyId, confirmedAt, confirmedByAccountId],
        );
        if (updated.rows[0]) return { outcome: 'CONFIRMED', device: mapDevice(updated.rows[0]) } as const;

        const existing = await client.query<DeviceRow>(
          `SELECT * FROM devices WHERE device_id = $1 AND family_id = $2`,
          [deviceId, familyId],
        );
        const row = existing.rows[0];
        if (!row) throw new SoftFailure<DeviceSoftCode>('DEVICE_NOT_FOUND');
        // Already PAIRED -- idempotent success, original pairedAt untouched.
        if (row.status === 'PAIRED') return { outcome: 'CONFIRMED', device: mapDevice(row) } as const;
        throw new SoftFailure<DeviceSoftCode>('INVALID_STATE');
      });
    } catch (error) {
      if (error instanceof SoftFailure) return { outcome: error.outcome } as ConfirmPairingResult;
      throw error;
    }
  }
}
