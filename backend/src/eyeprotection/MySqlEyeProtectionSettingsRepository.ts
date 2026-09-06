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
 * WRITE is authorized against the CALLER's own family before this
 * repository is ever reached (see EyeProtectionSettingsService), so
 * update() itself does no cross-family enforcement -- it is a plain keyed
 * upsert, not a second authorization boundary.
 *
 * get() is different: EyeProtectionSettingsService.get() is a bare
 * pass-through with NO authorization pre-check (reads are, by design,
 * scoped by the repository itself -- see that service's own doc comment),
 * so this repository is the ONLY thing standing between a caller and
 * another family's row. The SELECT therefore filters `AND family_id = ?`
 * on the caller's own familyId -- a caller-supplied childProfileId that
 * belongs to a different family, or doesn't exist at all, matches zero
 * rows either way and falls through to the exact same safe default below
 * (built from the CALLER's OWN familyId parameter, never a value read from
 * the database). That closes both a cross-family read/IDOR and the
 * existence oracle it created (a caller could otherwise tell "exists with
 * a saved setting" apart from "exists, no setting" apart from "doesn't
 * exist") in one change. FABLE-A008 / DW-W1-D. */
export class MySqlEyeProtectionSettingsRepository implements EyeProtectionSettingsRepository {
  async get(familyId: string, childProfileId: string): Promise<EyeProtectionSettings> {
    const { rows } = await runInTransaction((conn) =>
      execute<SettingsRow>(
        conn,
        `SELECT child_profile_id, family_id, reminders_enabled, updated_at FROM eye_protection_settings WHERE child_profile_id = ? AND family_id = ?`,
        [childProfileId, familyId],
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
