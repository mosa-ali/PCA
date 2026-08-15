/**
 * PCA-ADD-PA-043/044 (Writer65) -- persistence port for the generic
 * `platform_admin_settings` key/value table (migration 0016). One row per
 * logical setting key; `category` groups keys for listing
 * (BRANDING/PAYMENT_PROVIDER/NOTIFICATION/MAINTENANCE/FEATURE_FLAG).
 *
 * PCA-ADD-PA-044 write-only/masked enforcement lives ONE layer up
 * (PlatformAdminSettingsService/settingsRoutes.ts) -- this repository is a
 * plain CRUD port and DOES return `value_json` for sensitive rows when
 * asked (`getRaw`), because the domain service needs the real value to
 * resolve a provider reference at checkout time; the masking boundary is
 * "never serialize `value_json` back onto an HTTP response for a sensitive
 * row", which is an application-layer (route/service) decision, not a
 * storage-layer one -- exactly how `settlement_accounts.provider_ref` is
 * genuinely persisted but never returned by
 * `PlatformAdminSettlementService`'s masked views (see that service's own
 * header comment for the identical precedent).
 */
import type { PoolConnection } from 'mysql2/promise';
import { execute } from '../../db/pool.js';

export type PlatformAdminSettingCategory = 'BRANDING' | 'PAYMENT_PROVIDER' | 'NOTIFICATION' | 'MAINTENANCE' | 'FEATURE_FLAG';

export interface PlatformAdminSettingRecord {
  readonly settingKey: string;
  readonly category: PlatformAdminSettingCategory;
  readonly valueJson: string;
  readonly isSensitive: boolean;
  readonly maskedDisplay: string | null;
  readonly updatedAt: Date;
  readonly updatedByAdminId: string;
}

interface SettingRow {
  setting_key: string;
  category: PlatformAdminSettingCategory;
  value_json: string;
  is_sensitive: number;
  masked_display: string | null;
  updated_at: Date;
  updated_by_admin_id: string;
}

function toRecord(row: SettingRow): PlatformAdminSettingRecord {
  return {
    settingKey: row.setting_key,
    category: row.category,
    valueJson: row.value_json,
    isSensitive: row.is_sensitive === 1,
    maskedDisplay: row.masked_display,
    updatedAt: row.updated_at,
    updatedByAdminId: row.updated_by_admin_id,
  };
}

export interface PlatformAdminSettingsRepository {
  getRaw(conn: PoolConnection, settingKey: string): Promise<PlatformAdminSettingRecord | null>;
  listByCategory(conn: PoolConnection, category: PlatformAdminSettingCategory): Promise<PlatformAdminSettingRecord[]>;
  upsert(
    conn: PoolConnection,
    settingKey: string,
    category: PlatformAdminSettingCategory,
    valueJson: string,
    isSensitive: boolean,
    maskedDisplay: string | null,
    adminId: string,
  ): Promise<PlatformAdminSettingRecord>;
  deleteKey(conn: PoolConnection, settingKey: string): Promise<boolean>;
}

export class MySqlPlatformAdminSettingsRepository implements PlatformAdminSettingsRepository {
  async getRaw(conn: PoolConnection, settingKey: string): Promise<PlatformAdminSettingRecord | null> {
    const { rows } = await execute<SettingRow>(conn, `SELECT * FROM platform_admin_settings WHERE setting_key = ?`, [settingKey]);
    return rows[0] ? toRecord(rows[0]) : null;
  }

  async listByCategory(conn: PoolConnection, category: PlatformAdminSettingCategory): Promise<PlatformAdminSettingRecord[]> {
    const { rows } = await execute<SettingRow>(conn, `SELECT * FROM platform_admin_settings WHERE category = ? ORDER BY setting_key ASC`, [category]);
    return rows.map(toRecord);
  }

  async upsert(
    conn: PoolConnection,
    settingKey: string,
    category: PlatformAdminSettingCategory,
    valueJson: string,
    isSensitive: boolean,
    maskedDisplay: string | null,
    adminId: string,
  ): Promise<PlatformAdminSettingRecord> {
    await execute(
      conn,
      `INSERT INTO platform_admin_settings (setting_key, category, value_json, is_sensitive, masked_display, updated_by_admin_id)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE category = VALUES(category), value_json = VALUES(value_json), is_sensitive = VALUES(is_sensitive), masked_display = VALUES(masked_display), updated_by_admin_id = VALUES(updated_by_admin_id)`,
      [settingKey, category, valueJson, isSensitive ? 1 : 0, maskedDisplay, adminId],
    );
    const { rows } = await execute<SettingRow>(conn, `SELECT * FROM platform_admin_settings WHERE setting_key = ?`, [settingKey]);
    return toRecord(rows[0]);
  }

  async deleteKey(conn: PoolConnection, settingKey: string): Promise<boolean> {
    const { rowCount } = await execute(conn, `DELETE FROM platform_admin_settings WHERE setting_key = ?`, [settingKey]);
    return rowCount > 0;
  }
}
