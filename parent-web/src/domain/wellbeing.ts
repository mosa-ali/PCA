// WellbeingMessageControlV1 -- the UI-side data shape for the wellbeing
// message-control feature. Storage/delivery authority is out of scope here;
// this module only defines the shape the parent-web UI authors against, via
// WellbeingMessageAdminClient.
//
// TAXONOMY: parent-web does NOT define its own categories/triggers/preview
// surfaces. The canonical vocabulary is Android's `feature/wellbeing` runtime
// (docs/architecture/38_CANONICAL_WELLBEING_POLICY.md Section 1), expressed
// for client authoring by `@pca/parent-sdk-wellbeing-control`
// (PCA-WELL-006 / PCA-WELLCTRL-031 -- 13 categories; PCA-WELLCTRL-032 --
// 9 triggers). Those types are re-exported here rather than restated, so a
// local union can never drift out of the single logical vocabulary again.
import type { WellbeingCategory, WellbeingTrigger } from '@pca/parent-sdk-wellbeing-control';

export type {
  WellbeingCategory,
  WellbeingTrigger,
  PreviewSurface,
} from '@pca/parent-sdk-wellbeing-control';
export { WELLBEING_CATEGORIES, WELLBEING_TRIGGERS } from '@pca/parent-sdk-wellbeing-control';

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
