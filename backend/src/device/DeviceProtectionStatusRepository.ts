import { execute, runInTransaction } from '../db/pool.js';
import type { OpaqueFamilyId } from '../familytrustset/types.js';
import type { DeviceId } from './types.js';

export type ProtectionLevel = 'STANDARD' | 'PROTECTED' | 'DEGRADED' | 'AUTHORIZATION_REQUIRED' | 'NOT_SUPPORTED';

export interface DeviceProtectionStatusRecord {
  readonly deviceId: DeviceId;
  readonly familyId: OpaqueFamilyId;
  readonly protectionLevel: ProtectionLevel;
  /** Server receipt clock -- never a device-claimed timestamp. See migration 0024's own header comment for why. */
  readonly updatedAt: Date;
}

export interface DeviceProtectionStatusRepository {
  /** Upserts this device's current status -- one row per device, never a history log. */
  upsert(record: DeviceProtectionStatusRecord): Promise<void>;
  /** Atomically returns the prior status and records the new status for transition decisions. */
  recordAndReadPrevious(record: DeviceProtectionStatusRecord): Promise<DeviceProtectionStatusRecord | null>;
  findForDevice(familyId: OpaqueFamilyId, deviceId: DeviceId): Promise<DeviceProtectionStatusRecord | null>;
}

export class ProtectionStatusDeviceUnavailableError extends Error {
  constructor() {
    super('The protection status device or family is not active in the requested scope.');
    this.name = 'ProtectionStatusDeviceUnavailableError';
  }
}

interface DeviceProtectionStatusRow {
  device_id: string;
  family_id: string;
  protection_level: ProtectionLevel;
  updated_at: Date | string;
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function toRecord(row: DeviceProtectionStatusRow): DeviceProtectionStatusRecord {
  return {
    deviceId: row.device_id,
    familyId: row.family_id,
    protectionLevel: row.protection_level,
    updatedAt: toDate(row.updated_at),
  };
}

export class MySqlDeviceProtectionStatusRepository implements DeviceProtectionStatusRepository {
  async upsert(record: DeviceProtectionStatusRecord): Promise<void> {
    await this.recordAndReadPrevious(record);
  }

  async recordAndReadPrevious(record: DeviceProtectionStatusRecord): Promise<DeviceProtectionStatusRecord | null> {
    return runInTransaction(async (conn) => {
      // The status row may not exist yet, so locking it cannot serialize two
      // first reports. Lock the durable device row instead; every report for
      // this device takes the same lock before reading/upserting its status.
      const { rows: devices } = await execute<{ device_id: string }>(
        conn,
        `SELECT d.device_id
           FROM devices d
           JOIN families f ON f.family_id = d.family_id
          WHERE d.device_id = ?
            AND d.family_id = ?
            AND d.status = 'ACTIVE'
            AND f.status = 'ACTIVE'
            AND f.deleted_at IS NULL
          FOR UPDATE`,
        [record.deviceId, record.familyId],
      );
      if (!devices[0]) throw new ProtectionStatusDeviceUnavailableError();

      const { rows: previousRows } = await execute<DeviceProtectionStatusRow>(
        conn,
        `SELECT device_id, family_id, protection_level, updated_at
           FROM device_protection_status
          WHERE device_id = ? AND family_id = ?`,
        [record.deviceId, record.familyId],
      );
      await execute(
        conn,
        `INSERT INTO device_protection_status (device_id, family_id, protection_level, updated_at)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE protection_level = VALUES(protection_level), updated_at = VALUES(updated_at)`,
        [record.deviceId, record.familyId, record.protectionLevel, record.updatedAt],
      );
      return previousRows[0] ? toRecord(previousRows[0]) : null;
    });
  }

  async findForDevice(familyId: OpaqueFamilyId, deviceId: DeviceId): Promise<DeviceProtectionStatusRecord | null> {
    const { rows } = await runInTransaction((conn) =>
      execute<DeviceProtectionStatusRow>(
        conn,
        `SELECT s.device_id, s.family_id, s.protection_level, s.updated_at
           FROM device_protection_status s
           JOIN devices d ON d.device_id = s.device_id AND d.family_id = s.family_id
           JOIN families f ON f.family_id = d.family_id
          WHERE s.device_id = ?
            AND s.family_id = ?
            AND d.status = 'ACTIVE'
            AND f.status = 'ACTIVE'
            AND f.deleted_at IS NULL`,
        [deviceId, familyId],
      ),
    );
    return rows[0] ? toRecord(rows[0]) : null;
  }
}

/** Reference repository for focused local tests. */
export class InMemoryDeviceProtectionStatusRepository implements DeviceProtectionStatusRepository {
  private readonly records = new Map<string, DeviceProtectionStatusRecord>();

  private snapshot(record: DeviceProtectionStatusRecord): DeviceProtectionStatusRecord {
    return { ...record, updatedAt: new Date(record.updatedAt.getTime()) };
  }

  async upsert(record: DeviceProtectionStatusRecord): Promise<void> {
    // Date is mutable even though the record's TypeScript property is readonly.
    // Copy the server receipt clock both on write and read so a caller cannot
    // backdate or refresh the stored protection report through a shared object.
    this.records.set(record.deviceId, this.snapshot(record));
  }

  async recordAndReadPrevious(record: DeviceProtectionStatusRecord): Promise<DeviceProtectionStatusRecord | null> {
    // Keep the read + write synchronous within this async method, before its
    // first suspension point, so concurrent callers observe a serialized
    // transition just like the MySQL implementation's device-row lock.
    const stored = this.records.get(record.deviceId);
    const previous = stored?.familyId === record.familyId ? this.snapshot(stored) : null;
    this.records.set(record.deviceId, this.snapshot(record));
    return previous;
  }

  async findForDevice(familyId: OpaqueFamilyId, deviceId: DeviceId): Promise<DeviceProtectionStatusRecord | null> {
    const record = this.records.get(deviceId);
    if (record === undefined || record.familyId !== familyId) return null;
    return this.snapshot(record);
  }
}
