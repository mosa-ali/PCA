import type { ParentPreferences, ParentPreferencesClient, ParentPreferencesPatch } from '../interfaces';

let preferences: ParentPreferences = {
  accountId: 'dev-parent-account',
  language: 'en',
  emailAlertsEnabled: true,
  pushRequestsEnabled: true,
  updatedAtUtc: new Date(0).toISOString(),
};

export class DevParentPreferencesClient implements ParentPreferencesClient {
  async get(): Promise<ParentPreferences> {
    return { ...preferences };
  }

  async update(patch: ParentPreferencesPatch): Promise<ParentPreferences> {
    preferences = { ...preferences, ...patch, updatedAtUtc: new Date().toISOString() };
    return { ...preferences };
  }
}
