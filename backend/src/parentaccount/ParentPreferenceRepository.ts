export type ParentLanguage = 'en' | 'ar';
export type ParentEmailDestinationState = 'UNVERIFIED' | 'VERIFIED';

export interface ParentPreferences {
  accountId: string;
  language: ParentLanguage;
  emailAlertsEnabled: boolean;
  pushRequestsEnabled: boolean;
  emailDestination: string | null;
  emailDestinationState: ParentEmailDestinationState;
  updatedAtUtc: string;
}

export interface ParentPreferencesPatch {
  language?: ParentLanguage;
  emailAlertsEnabled?: boolean;
  pushRequestsEnabled?: boolean;
  emailDestination?: string | null;
}

export interface ParentPreferenceRepository {
  get(accountId: string): Promise<ParentPreferences>;
  update(accountId: string, patch: ParentPreferencesPatch): Promise<ParentPreferences>;
}
