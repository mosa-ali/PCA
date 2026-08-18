import { execute, runInTransaction } from '../db/pool.js';
import type { ParentLanguage, ParentPreferenceRepository, ParentPreferences, ParentPreferencesPatch } from './ParentPreferenceRepository.js';

interface PreferenceRow {
  account_id: string;
  language_code: ParentLanguage;
  email_alerts_enabled: number;
  push_requests_enabled: number;
  updated_at: Date;
}

function toPreferences(row: PreferenceRow): ParentPreferences {
  return {
    accountId: row.account_id,
    language: row.language_code,
    emailAlertsEnabled: row.email_alerts_enabled === 1,
    pushRequestsEnabled: row.push_requests_enabled === 1,
    updatedAtUtc: row.updated_at.toISOString(),
  };
}

export class MySqlParentPreferenceRepository implements ParentPreferenceRepository {
  async get(accountId: string): Promise<ParentPreferences> {
    const { rows } = await runInTransaction((conn) =>
      execute<PreferenceRow>(conn, `SELECT account_id, language_code, email_alerts_enabled, push_requests_enabled, updated_at FROM parent_account_preferences WHERE account_id = ?`, [accountId]),
    );
    if (rows[0]) return toPreferences(rows[0]);
    return {
      accountId,
      language: 'en',
      emailAlertsEnabled: true,
      pushRequestsEnabled: true,
      updatedAtUtc: new Date(0).toISOString(),
    };
  }

  async update(accountId: string, patch: ParentPreferencesPatch): Promise<ParentPreferences> {
    const now = new Date();
    const hasLanguage = patch.language !== undefined;
    const hasEmail = patch.emailAlertsEnabled !== undefined;
    const hasPush = patch.pushRequestsEnabled !== undefined;
    await runInTransaction((conn) =>
      execute(
        conn,
        `INSERT INTO parent_account_preferences
           (account_id, language_code, email_alerts_enabled, push_requests_enabled, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           language_code = IF(?, ?, language_code),
           email_alerts_enabled = IF(?, ?, email_alerts_enabled),
           push_requests_enabled = IF(?, ?, push_requests_enabled),
           updated_at = ?`,
        [
          accountId,
          patch.language ?? 'en',
          patch.emailAlertsEnabled === false ? 0 : 1,
          patch.pushRequestsEnabled === false ? 0 : 1,
          now,
          hasLanguage ? 1 : 0,
          patch.language ?? 'en',
          hasEmail ? 1 : 0,
          patch.emailAlertsEnabled === true ? 1 : 0,
          hasPush ? 1 : 0,
          patch.pushRequestsEnabled === true ? 1 : 0,
          now,
        ],
      ),
    );
    return this.get(accountId);
  }
}
