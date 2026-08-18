export type ParentLanguage = 'en' | 'ar';

export interface ParentPreferences {
  accountId: string;
  language: ParentLanguage;
  emailAlertsEnabled: boolean;
  pushRequestsEnabled: boolean;
  updatedAtUtc: string;
}

export interface ParentPreferencesPatch {
  language?: ParentLanguage;
  emailAlertsEnabled?: boolean;
  pushRequestsEnabled?: boolean;
}

export interface ParentPreferenceRepository {
  get(accountId: string): Promise<ParentPreferences>;
  update(accountId: string, patch: ParentPreferencesPatch): Promise<ParentPreferences>;
}
