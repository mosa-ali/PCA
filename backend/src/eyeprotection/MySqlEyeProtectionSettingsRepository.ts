import { execute, runInTransaction } from '../db/pool.js';
import type { EyeProtectionSettings, EyeProtectionSettingsPatch, EyeProtectionSettingsRepository } from './EyeProtectionSettingsRepository.js';

interface SettingsRow {
  child_profile_id: string;
  family_id: string;
  reminders_enabled: number;
  updated_at: Date;
}

function toSettings(row: SettingsRow): EyeProtectionSettings {
  return {
    childProfileId: row.child_profile_id,
    familyId: row.family_id,
    remindersEnabled: row.reminders_enabled === 1,
    updatedAtUtc: row.updated_at.toISOString(),
  };
}

/** Same INSERT ... ON DUPLICATE KEY UPDATE upsert shape as
 * parentaccount/MySqlParentPreferenceRepository.ts -- see that file's own
 * doc comment. `family_id` is written on first insert only (a childProfileId
 * never legitimately migrates between families through this table); every
 * mutation is authorized against the CALLER's own family before this
 * repository is ever reached (see EyeProtectionSettingsService), so this
 * class itself does no cross-family enforcement -- it is a plain keyed
 * upsert, not a second authorization boundary. */
export class MySqlEyeProtectionSettingsRepository implements EyeProtectionSettingsRepository {
  async get(familyId: string, childProfileId: string): Promise<EyeProtectionSettings> {
    const { rows } = await runInTransaction((conn) =>
      execute<SettingsRow>(
        conn,
        `SELECT child_profile_id, family_id, reminders_enabled, updated_at FROM eye_protection_settings WHERE child_profile_id = ?`,
        [childProfileId],
      ),
    );
    if (rows[0]) return toSettings(rows[0]);
    return {
      childProfileId,
      familyId,
      remindersEnabled: false,
      updatedAtUtc: new Date(0).toISOString(),
    };
  }

  async update(familyId: string, childProfileId: string, patch: EyeProtectionSettingsPatch): Promise<EyeProtectionSettings> {
    const now = new Date();
    await runInTransaction((conn) =>
      execute(
        conn,
        `INSERT INTO eye_protection_settings (child_profile_id, family_id, reminders_enabled, updated_at)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           reminders_enabled = ?,
           updated_at = ?`,
        [childProfileId, familyId, patch.remindersEnabled ? 1 : 0, now, patch.remindersEnabled ? 1 : 0, now],
      ),
    );
    return this.get(familyId, childProfileId);
  }
}
