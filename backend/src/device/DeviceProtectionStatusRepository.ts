import { execute, runInTransaction } from '../db/pool.js';
import { familyEpochFromStorage, isFamilyEpochNumber } from '../familyepoch/bounds.js';
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

/** Accepted-head version resolved immediately before an authenticated report. */
export interface ProtectionStatusAuthoritySnapshot {
  readonly dskKeyId: string;
  readonly trustSetEpoch: number;
  readonly keyEpoch: number;
}

const PROTECTION_LEVELS: ReadonlySet<string> = new Set([
  'STANDARD', 'PROTECTED', 'DEGRADED', 'AUTHORIZATION_REQUIRED', 'NOT_SUPPORTED',
]);
const MYSQL_DATETIME_MIN_MS = Date.UTC(1000, 0, 1, 0, 0, 0, 0);
const MYSQL_DATETIME_MAX_MS = Date.UTC(9999, 11, 31, 23, 59, 59, 999);

function grantsProtectiveAuthority(level: ProtectionLevel): boolean {
  return level === 'PROTECTED' || level === 'DEGRADED';
}

/**
 * Server receipt timestamps have millisecond precision. If two reports tie,
 * their true arrival order is unknowable; never let that tie restore
 * protective authority after a non-protective state was already recorded.
 * A tied downgrade remains safe, and same-authority-category updates remain
 * order-independent for RealProtectiveAuthorityResolver.
 */
function isStaleProtectionStatus(
  incoming: DeviceProtectionStatusRecord,
  current: DeviceProtectionStatusRecord,
): boolean {
  const incomingMs = incoming.updatedAt.getTime();
  const currentMs = current.updatedAt.getTime();
  return incomingMs < currentMs ||
    (incomingMs === currentMs && grantsProtectiveAuthority(incoming.protectionLevel) &&
      !grantsProtectiveAuthority(current.protectionLevel));
}

/** Validate and detach caller-owned mutable data before any repository await. */
function snapshotRecord(record: DeviceProtectionStatusRecord): DeviceProtectionStatusRecord {
  if (!record || typeof record !== 'object' ||
      typeof record.deviceId !== 'string' || record.deviceId.length === 0 || record.deviceId.length > 128 ||
      typeof record.familyId !== 'string' || record.familyId.length === 0 || record.familyId.length > 128 ||
      typeof record.protectionLevel !== 'string' || !PROTECTION_LEVELS.has(record.protectionLevel) ||
      !(record.updatedAt instanceof Date)) {
    throw new TypeError('Protection status record is invalid.');
  }
  const updatedAtMs = record.updatedAt.getTime();
  if (!Number.isFinite(updatedAtMs) || updatedAtMs < MYSQL_DATETIME_MIN_MS || updatedAtMs > MYSQL_DATETIME_MAX_MS) {
    throw new TypeError('Protection status receipt timestamp is outside the supported database range.');
  }
  return { ...record, updatedAt: new Date(updatedAtMs) };
}

function snapshotAuthority(authority?: ProtectionStatusAuthoritySnapshot): ProtectionStatusAuthoritySnapshot | undefined {
  if (authority === undefined) return undefined;
  if (!authority || typeof authority !== 'object' ||
      typeof authority.dskKeyId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(authority.dskKeyId) ||
      !isFamilyEpochNumber(authority.trustSetEpoch, 1) || !isFamilyEpochNumber(authority.keyEpoch, 1)) {
    throw new TypeError('Protection status authority snapshot is invalid.');
  }
  return { ...authority };
}

export interface DeviceProtectionStatusRepository {
  /** Upserts this device's current status -- one row per device, never a history log. */
  upsert(record: DeviceProtectionStatusRecord, authority?: ProtectionStatusAuthoritySnapshot): Promise<void>;
  /** Atomically returns the prior status and records the new status for transition decisions. */
  recordAndReadPrevious(
    record: DeviceProtectionStatusRecord,
    authority?: ProtectionStatusAuthoritySnapshot,
  ): Promise<DeviceProtectionStatusRecord | null>;
  findForDevice(familyId: OpaqueFamilyId, deviceId: DeviceId): Promise<DeviceProtectionStatusRecord | null>;
}

export class ProtectionStatusDeviceUnavailableError extends Error {
  constructor() {
    super('The protection status device or family is not active in the requested scope.');
    this.name = 'ProtectionStatusDeviceUnavailableError';
  }
}

/** The accepted Trust Set head moved after resolution and before this report could persist. */
export class ProtectionStatusAuthorityChangedError extends Error {
  constructor() {
    super('The accepted Trust Set head changed before the protection status write.');
    this.name = 'ProtectionStatusAuthorityChangedError';
  }
}

/** An older server-received report was ignored to preserve the latest status. */
export class ProtectionStatusStaleReportError extends Error {
  constructor() {
    super('The protection status report is older than the stored report.');
    this.name = 'ProtectionStatusStaleReportError';
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
  async upsert(record: DeviceProtectionStatusRecord, authority?: ProtectionStatusAuthoritySnapshot): Promise<void> {
    await this.recordAndReadPrevious(record, authority);
  }

  async recordAndReadPrevious(
    record: DeviceProtectionStatusRecord,
    authority?: ProtectionStatusAuthoritySnapshot,
  ): Promise<DeviceProtectionStatusRecord | null> {
    const safeRecord = snapshotRecord(record);
    const safeAuthority = snapshotAuthority(authority);
    return runInTransaction(async (conn) => {
      if (safeAuthority !== undefined) {
        // Match epoch append's family-level serialization point and lock
        // order (floor row, then device row). If an append committed after
        // the route's resolver snapshot, its new floors are visible here and
        // the report fails closed. If this report gets the lock first, it
        // linearizes before that append and the writer waits until commit.
        const { rows: floors } = await execute<{
          minimum_accepted_trust_set_epoch: number | string | bigint;
          minimum_accepted_key_epoch: number | string | bigint;
        }>(
          conn,
          `SELECT minimum_accepted_trust_set_epoch, minimum_accepted_key_epoch
             FROM family_epoch_floors
            WHERE family_id = ?
            FOR UPDATE`,
          [safeRecord.familyId],
        );
        const floor = floors[0];
        if (!floor ||
            familyEpochFromStorage(floor.minimum_accepted_trust_set_epoch) !== safeAuthority.trustSetEpoch ||
            familyEpochFromStorage(floor.minimum_accepted_key_epoch) !== safeAuthority.keyEpoch) {
          throw new ProtectionStatusAuthorityChangedError();
        }
      }

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
        [safeRecord.deviceId, safeRecord.familyId],
      );
      if (!devices[0]) throw new ProtectionStatusDeviceUnavailableError();

      if (safeAuthority !== undefined) {
        // The accepted-head floor does not move for an ordinary DSK revoke.
        // Lock and recheck the exact session key using the same
        // floor -> device -> key order used by epoch acceptance/revocation.
        const { rows: activeKeys } = await execute<{ key_id: string }>(
          conn,
          `SELECT key_id
             FROM device_public_keys
            WHERE device_id = ?
              AND key_id = ?
              AND key_purpose = 'DSK'
              AND status = 'ACTIVE'
            LIMIT 1
            FOR UPDATE`,
          [safeRecord.deviceId, safeAuthority.dskKeyId],
        );
        if (activeKeys.length !== 1) throw new ProtectionStatusAuthorityChangedError();
      }

      const { rows: previousRows } = await execute<DeviceProtectionStatusRow>(
        conn,
        `SELECT device_id, family_id, protection_level, updated_at
           FROM device_protection_status
          WHERE device_id = ? AND family_id = ?`,
        [safeRecord.deviceId, safeRecord.familyId],
      );
      const previous = previousRows[0] ? toRecord(previousRows[0]) : null;
      // A slower transaction must not replace a newer server-received state
      // with an older report timestamp. The caller still receives the
      // previous value so transition notification logic remains stable.
      if (previous && isStaleProtectionStatus(safeRecord, previous)) {
        throw new ProtectionStatusStaleReportError();
      }
      await execute(
        conn,
        `INSERT INTO device_protection_status (device_id, family_id, protection_level, updated_at)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE protection_level = VALUES(protection_level), updated_at = VALUES(updated_at)`,
        [safeRecord.deviceId, safeRecord.familyId, safeRecord.protectionLevel, safeRecord.updatedAt],
      );
      return previous;
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
    return snapshotRecord(record);
  }

  async upsert(record: DeviceProtectionStatusRecord, _authority?: ProtectionStatusAuthoritySnapshot): Promise<void> {
    // Date is mutable even though the record's TypeScript property is readonly.
    // Copy the server receipt clock both on write and read so a caller cannot
    // backdate or refresh the stored protection report through a shared object.
    const safeRecord = snapshotRecord(record);
    snapshotAuthority(_authority);
    const current = this.records.get(safeRecord.deviceId);
    if (current && current.familyId !== safeRecord.familyId) throw new ProtectionStatusDeviceUnavailableError();
    if (current && current.familyId === safeRecord.familyId && isStaleProtectionStatus(safeRecord, current)) {
      throw new ProtectionStatusStaleReportError();
    }
    this.records.set(safeRecord.deviceId, safeRecord);
  }

  async recordAndReadPrevious(
    record: DeviceProtectionStatusRecord,
    _authority?: ProtectionStatusAuthoritySnapshot,
  ): Promise<DeviceProtectionStatusRecord | null> {
    // Keep the read + write synchronous within this async method, before its
    // first suspension point, so concurrent callers observe a serialized
    // transition just like the MySQL implementation's device-row lock.
    const safeRecord = snapshotRecord(record);
    snapshotAuthority(_authority);
    const stored = this.records.get(safeRecord.deviceId);
    if (stored && stored.familyId !== safeRecord.familyId) throw new ProtectionStatusDeviceUnavailableError();
    const previous = stored?.familyId === safeRecord.familyId ? this.snapshot(stored) : null;
    if (previous && isStaleProtectionStatus(safeRecord, previous)) {
      throw new ProtectionStatusStaleReportError();
    }
    this.records.set(safeRecord.deviceId, safeRecord);
    return previous;
  }

  async findForDevice(familyId: OpaqueFamilyId, deviceId: DeviceId): Promise<DeviceProtectionStatusRecord | null> {
    const record = this.records.get(deviceId);
    if (record === undefined || record.familyId !== familyId) return null;
    return this.snapshot(record);
  }
}
