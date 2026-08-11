import { execute, isDuplicateEntry, runInTransaction, SoftFailure } from '../db/pool.js';
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

export class MySqlDeviceRepository implements DeviceRepository {
  async createDeviceWithKey(device: DeviceRecord, key: DeviceKeyRecord): Promise<CreateDeviceResult> {
    try {
      return await runInTransaction(async (conn) => {
        await execute(
          conn,
          `INSERT INTO devices (device_id, family_id, platform, status, created_at, revoked_at, paired_at, paired_by_account_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
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
          await execute(
            conn,
            `INSERT INTO device_public_keys (device_id, key_id, key_purpose, public_key, status, created_at, revoked_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [key.deviceId, key.keyId, key.keyPurpose, key.publicKey, key.status, key.createdAt, key.revokedAt],
          );
        } catch (error) {
          if (isDuplicateEntry(error)) throw new SoftFailure<DeviceSoftCode>('DUPLICATE_KEY');
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
    const { rows } = await runInTransaction((conn) =>
      execute<DeviceRow>(conn, `SELECT * FROM devices WHERE device_id = ? AND family_id = ?`, [deviceId, familyId]),
    );
    return rows[0] ? mapDevice(rows[0]) : null;
  }

  async findDeviceUnscoped(deviceId: DeviceId): Promise<DeviceRecord | null> {
    const { rows } = await runInTransaction((conn) =>
      execute<DeviceRow>(conn, `SELECT * FROM devices WHERE device_id = ?`, [deviceId]),
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
      return await runInTransaction(async (conn) => {
        // status != 'REVOKED' guarantees any row this UPDATE actually
        // matches also actually changes, so MySQL's affectedRows (which
        // counts changed rows, not merely matched rows) still tells us
        // "this call performed the first-ever revocation" -- an
        // already-revoked device falls straight through to the SELECT
        // below, and its first revocation's timestamp stays authoritative
        // rather than being silently rewritten by a later, redundant call.
        const updateResult = await execute(
          conn,
          `UPDATE devices SET status = 'REVOKED', revoked_at = ?
           WHERE device_id = ? AND family_id = ? AND status != 'REVOKED'`,
          [revokedAt, deviceId, familyId],
        );
        let deviceRow: DeviceRow | undefined;
        if (updateResult.rowCount > 0) {
          const reread = await execute<DeviceRow>(conn, `SELECT * FROM devices WHERE device_id = ?`, [deviceId]);
          deviceRow = reread.rows[0];
        } else {
          const existing = await execute<DeviceRow>(
            conn,
            `SELECT * FROM devices WHERE device_id = ? AND family_id = ?`,
            [deviceId, familyId],
          );
          deviceRow = existing.rows[0];
          if (!deviceRow) throw new SoftFailure<DeviceSoftCode>('DEVICE_NOT_FOUND');
        }

        // AND status = 'ACTIVE' already makes this idempotent on repeat
        // calls -- an already-revoked key is never re-touched, so its
        // original revoked_at is preserved automatically.
        await execute(conn, `UPDATE device_public_keys SET status = 'REVOKED', revoked_at = ? WHERE device_id = ? AND status = 'ACTIVE'`, [
          revokedAt,
          deviceId,
        ]);
        const keysResult = await execute<DeviceKeyRow>(conn, `SELECT * FROM device_public_keys WHERE device_id = ?`, [
          deviceId,
        ]);
        return { outcome: 'REVOKED', device: mapDevice(deviceRow), keys: keysResult.rows.map(mapKey) } as const;
      });
    } catch (error) {
      if (error instanceof SoftFailure) return { outcome: 'DEVICE_NOT_FOUND' };
      throw error;
    }
  }

  async addKeyAtomically(familyId: OpaqueFamilyId, record: DeviceKeyRecord): Promise<AddKeyResult> {
    try {
      return await runInTransaction(async (conn) => {
        const deviceResult = await execute<DeviceRow>(
          conn,
          `SELECT * FROM devices WHERE device_id = ? AND family_id = ? FOR UPDATE`,
          [record.deviceId, familyId],
        );
        const deviceRow = deviceResult.rows[0];
        if (!deviceRow) throw new SoftFailure<DeviceSoftCode>('DEVICE_NOT_FOUND');
        if (deviceRow.status === 'REVOKED') throw new SoftFailure<DeviceSoftCode>('DEVICE_REVOKED');

        try {
          await execute(
            conn,
            `INSERT INTO device_public_keys (device_id, key_id, key_purpose, public_key, status, created_at, revoked_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [record.deviceId, record.keyId, record.keyPurpose, record.publicKey, record.status, record.createdAt, record.revokedAt],
          );
        } catch (error) {
          if (isDuplicateEntry(error)) throw new SoftFailure<DeviceSoftCode>('DUPLICATE_KEY');
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
    return runInTransaction(async (conn) => {
      const device = await execute(conn, `SELECT 1 FROM devices WHERE device_id = ? AND family_id = ?`, [
        deviceId,
        familyId,
      ]);
      if (device.rowCount === 0) return [];
      const keys = await execute<DeviceKeyRow>(conn, `SELECT * FROM device_public_keys WHERE device_id = ?`, [
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
      return await runInTransaction(async (conn) => {
        const device = await execute(conn, `SELECT 1 FROM devices WHERE device_id = ? AND family_id = ?`, [
          deviceId,
          familyId,
        ]);
        if (device.rowCount === 0) throw new SoftFailure<DeviceSoftCode>('DEVICE_NOT_FOUND');

        const updated = await execute(
          conn,
          `UPDATE device_public_keys SET status = 'REVOKED', revoked_at = ?
           WHERE device_id = ? AND key_id = ? AND status != 'REVOKED'`,
          [revokedAt, deviceId, keyId],
        );
        if (updated.rowCount > 0) {
          const reread = await execute<DeviceKeyRow>(
            conn,
            `SELECT * FROM device_public_keys WHERE device_id = ? AND key_id = ?`,
            [deviceId, keyId],
          );
          return { outcome: 'REVOKED', key: mapKey(reread.rows[0]!) } as const;
        }

        const existing = await execute<DeviceKeyRow>(
          conn,
          `SELECT * FROM device_public_keys WHERE device_id = ? AND key_id = ?`,
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
      return await runInTransaction(async (conn) => {
        const updated = await execute(
          conn,
          `UPDATE devices SET status = 'PAIRED', paired_at = ?, paired_by_account_id = ?
           WHERE device_id = ? AND family_id = ? AND status = 'PAIRING_PENDING'`,
          [confirmedAt, confirmedByAccountId, deviceId, familyId],
        );
        if (updated.rowCount > 0) {
          const reread = await execute<DeviceRow>(conn, `SELECT * FROM devices WHERE device_id = ? AND family_id = ?`, [
            deviceId,
            familyId,
          ]);
          return { outcome: 'CONFIRMED', device: mapDevice(reread.rows[0]!) } as const;
        }

        const existing = await execute<DeviceRow>(conn, `SELECT * FROM devices WHERE device_id = ? AND family_id = ?`, [
          deviceId,
          familyId,
        ]);
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
