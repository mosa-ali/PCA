import { randomUUID } from 'node:crypto';
import { execute, runInTransaction } from '../db/pool.js';
import { SafeZoneError, type NewSafeZone, type SafeZone, type SafeZonePatch, type SafeZoneRepository } from './SafeZoneRepository.js';

interface SafeZoneRow {
  zone_id: string;
  family_id: string;
  child_profile_id: string;
  label: string;
  latitude: number | string;
  longitude: number | string;
  radius_meters: number;
  enabled: number;
  revision: number;
  delivery_state: 'PENDING_OFFLINE' | 'READY';
  created_at: Date;
  updated_at: Date;
}

function toSafeZone(row: SafeZoneRow): SafeZone {
  return {
    zoneId: row.zone_id,
    familyId: row.family_id,
    childProfileId: row.child_profile_id,
    label: row.label,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    radiusMeters: row.radius_meters,
    enabled: row.enabled === 1,
    revision: row.revision,
    deliveryState: row.delivery_state,
    createdAtUtc: row.created_at.toISOString(),
    updatedAtUtc: row.updated_at.toISOString(),
  };
}

const SELECT_COLUMNS = `zone_id, family_id, child_profile_id, label, latitude, longitude, radius_meters, enabled, revision, delivery_state, created_at, updated_at`;

export class MySqlSafeZoneRepository implements SafeZoneRepository {
  async list(familyId: string): Promise<SafeZone[]> {
    const { rows } = await runInTransaction((conn) => execute<SafeZoneRow>(conn, `SELECT ${SELECT_COLUMNS} FROM safe_zones WHERE family_id = ? ORDER BY zone_id`, [familyId]));
    return rows.map(toSafeZone);
  }

  async create(input: NewSafeZone): Promise<SafeZone> {
    const zoneId = randomUUID();
    const now = new Date();
    await runInTransaction(async (conn) => {
      const { rows } = await execute<{ present: number }>(conn, `SELECT 1 AS present FROM enrollment_invitations WHERE family_id = ? AND child_profile_id = ? LIMIT 1`, [input.familyId, input.childProfileId]);
      if (!rows[0]) throw new SafeZoneError('CHILD_NOT_IN_FAMILY');
      await execute(conn, `INSERT INTO safe_zones (zone_id, family_id, child_profile_id, label, latitude, longitude, radius_meters, enabled, revision, delivery_state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 'PENDING_OFFLINE', ?, ?)`, [zoneId, input.familyId, input.childProfileId, input.label, input.latitude, input.longitude, input.radiusMeters, input.enabled ? 1 : 0, now, now]);
    });
    const { rows } = await runInTransaction((conn) => execute<SafeZoneRow>(conn, `SELECT ${SELECT_COLUMNS} FROM safe_zones WHERE zone_id = ? AND family_id = ?`, [zoneId, input.familyId]));
    if (!rows[0]) throw new SafeZoneError('NOT_FOUND');
    return toSafeZone(rows[0]);
  }

  async update(familyId: string, zoneId: string, patch: SafeZonePatch): Promise<SafeZone> {
    const now = new Date();
    const { rowCount } = await runInTransaction((conn) => execute(conn, `UPDATE safe_zones SET label = COALESCE(?, label), latitude = COALESCE(?, latitude), longitude = COALESCE(?, longitude), radius_meters = COALESCE(?, radius_meters), enabled = COALESCE(?, enabled), revision = revision + 1, delivery_state = 'PENDING_OFFLINE', updated_at = ? WHERE zone_id = ? AND family_id = ?`, [patch.label ?? null, patch.latitude ?? null, patch.longitude ?? null, patch.radiusMeters ?? null, patch.enabled === undefined ? null : patch.enabled ? 1 : 0, now, zoneId, familyId]));
    if (rowCount === 0) throw new SafeZoneError('NOT_FOUND');
    const { rows } = await runInTransaction((conn) => execute<SafeZoneRow>(conn, `SELECT ${SELECT_COLUMNS} FROM safe_zones WHERE zone_id = ? AND family_id = ?`, [zoneId, familyId]));
    if (!rows[0]) throw new SafeZoneError('NOT_FOUND');
    return toSafeZone(rows[0]);
  }

  async remove(familyId: string, zoneId: string): Promise<boolean> {
    const { rowCount } = await runInTransaction((conn) => execute(conn, `DELETE FROM safe_zones WHERE zone_id = ? AND family_id = ?`, [zoneId, familyId]));
    return rowCount > 0;
  }
}
