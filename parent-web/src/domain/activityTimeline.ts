// PCA-FR-092: client-side domain type for a consolidated, per-child
// activity timeline -- composed entirely from the SAME decrypted,
// client-side family-data path every other ParentFamilyDataGateway method
// already uses (docs/architecture/09_SECURITY_PRIVACY_E2EE.md Section 5;
// see ../api/real/realParentFamilyDataGateway.ts). This is deliberately
// NOT a new backend endpoint or a new data class -- it is a category-level
// merge of the existing activity entities already defined in
// docs/architecture/10_DATA_MODEL_LOCAL_STORAGE.md Section 4
// (UsageSession, WebVisit, ContentBlockEvent, LocationPoint, BreakSession,
// ProximityEvent, PrayerReminderEvent), all of which are child-device-local
// and only ever reach the parent's browser as this same E2EE-decrypted
// payload doc 09 Section 5 already governs.
//
// Per doc 26 Section "What parents can see": category-level explanations,
// never a raw URL/precise coordinate/message content unless the specific
// feature page itself already discloses that detail. `summary` here is
// always a plain-language, category-level string; `detail` is an optional
// COARSE bucket (a classification/action/reason code), never free-text
// content.
export type ActivityTimelineCategory = 'APP_USAGE' | 'WEB_BROWSING' | 'CONTENT_BLOCK' | 'LOCATION' | 'BREAK_SESSION' | 'EYE_PROTECTION' | 'PRAYER_REMINDER';

export interface ActivityTimelineEntry {
  entryId: string;
  childId: string;
  category: ActivityTimelineCategory;
  timestampUtc: string;
  /** Plain-language, category-level summary -- see file header. */
  summary: string;
  /** Optional coarse detail bucket (e.g. a classification/action/reason code) -- never message/content text. */
  detail?: string | null;
}
