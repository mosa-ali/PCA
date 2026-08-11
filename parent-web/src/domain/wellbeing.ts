// WellbeingMessageControlV1 -- the UI-side data shape for the future
// Agent-8 wellbeing message-control feature. Storage/delivery authority is
// out of scope here; this module only defines the shape the parent-web UI
// authors against, via WellbeingMessageAdminClient.

export type WellbeingCategory =
  | 'ENCOURAGEMENT'
  | 'BREAK_REMINDER'
  | 'FOCUS'
  | 'GRATITUDE'
  | 'SAFETY_CHECK_IN'
  | 'CUSTOM';

export type WellbeingTrigger =
  | 'BREAK_DUE'
  | 'CONTINUOUS_USE_WARNING'
  | 'APP_LAUNCH'
  | 'SCHEDULED_TIME_WINDOW'
  | 'LOCK_SCREEN'
  | 'MANUAL';

export type DayOfWeek = 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT' | 'SUN';

export interface TimeWindow {
  startLocalTime: string; // HH:mm, interpreted in the child device's local time
  endLocalTime: string;
}

export interface LanguageText {
  languageTag: 'en' | 'ar';
  text: string;
}

/**
 * A single family-authored or curated-and-adopted message.
 *
 * `languageTexts` are authored separately per language -- there is
 * deliberately no auto-translate step (doc 20 Section 2: PCA does not have
 * developers or machines invent Arabic content at runtime).
 */
export interface WellbeingCustomMessage {
  messageId: string;
  sourceCuratedId: string | null; // set when duplicated from a curated suggestion
  languageTexts: LanguageText[];
  category: WellbeingCategory;
  enabled: boolean;
  archived: boolean;
  startDate: string | null; // ISO date
  endDate: string | null; // ISO date
  daysOfWeek: DayOfWeek[];
  timeWindows: TimeWindow[];
  triggers: WellbeingTrigger[];
  minimumIntervalMinutes: number;
  maximumPerDay: number;
  repeatCooldownMinutes: number;
  lockScreenAllowed: boolean;
  dismissible: boolean;
  snoozable: boolean;
  requiresAdultSupervision: boolean;
  targetChildIds: string[];
  createdAtUtc: string;
  updatedAtUtc: string;
}

export interface CuratedSuggestion {
  curatedId: string;
  languageTexts: LanguageText[];
  category: WellbeingCategory;
  requiresAdultSupervision: boolean;
  recommendedTriggers: WellbeingTrigger[];
}

export interface WellbeingMessageControlV1 {
  version: 1;
  policyRevision: number;
  targets: string[]; // childIds this control document applies to at the family level
  enabled: boolean;
  selectedCuratedSuggestionIds: string[];
  customMessages: WellbeingCustomMessage[];
  updatedAtUtc: string;
}

export type PreviewSurface =
  | 'IN_APP_CARD'
  | 'STANDARD_NOTIFICATION'
  | 'LOCK_SCREEN_REDACTED'
  | 'MOBILE_VIEWPORT';
