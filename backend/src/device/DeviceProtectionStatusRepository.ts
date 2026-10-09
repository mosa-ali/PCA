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
  findForDevice(familyId: OpaqueFamilyId, deviceId: DeviceId): Promise<DeviceProtectionStatusRecord | null>;
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
    await runInTransaction((conn) =>
      execute(
        conn,
        `INSERT INTO device_protection_status (device_id, family_id, protection_level, updated_at)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE protection_level = VALUES(protection_level), updated_at = VALUES(updated_at)`,
        [record.deviceId, record.familyId, record.protectionLevel, record.updatedAt],
      ),
    );
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

  async findForDevice(familyId: OpaqueFamilyId, deviceId: DeviceId): Promise<DeviceProtectionStatusRecord | null> {
    const record = this.records.get(deviceId);
    if (record === undefined || record.familyId !== familyId) return null;
    return this.snapshot(record);
  }
}
