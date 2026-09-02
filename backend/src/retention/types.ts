export type RetentionWindow = '14_DAYS' | '1_MONTH' | '3_MONTHS' | '6_MONTHS' | '9_MONTHS';

/**
 * doc 11 Section 3.1 -- entity classes SUBJECT to the general/location
 * retention window and to "Delete now" (Section 6). Deliberately does NOT
 * include a variant for Section 3.2's protected entities (Family,
 * DeviceKeyMetadata, current Policy, roles, recovery-existence record,
 * license) -- those are never modeled as a RetentionEntityClass at all, so
 * planPurge (engine.ts) is structurally incapable of referencing them
 * (PCA-DATA-020: "a scope restriction on which tables the deletion job is
 * allowed to touch," enforced here at the type level, not by a runtime
 * exception list).
 *
 * Mapping to doc 10's entity names, where not self-evident: `WEB_VISIT` =
 * WebVisit (4.2), `CONTENT_BLOCK_EVENT` = ContentBlockEvent (4.3),
 * `USAGE_SESSION` = UsageSession (4.1), `BREAK_SESSION` = BreakSession
 * (4.5), `PROXIMITY_EVENT` = ProximityEvent (4.6), `LOCATION_POINT` =
 * LocationPoint (4.4), `PRAYER_REMINDER_EVENT` = PrayerReminderEvent (4.7),
 * `INSTALLED_APP_EVENT` = InstalledAppEvent (PCA-FR-045/PCA-FR-131's
 * install/uninstall observation record). The device-side engine already
 * purges that table on the ordinary general window
 * (android RetentionEngine.runGeneralWindowCleanup's
 * `record("InstalledAppEvent", ...)` line, alongside UsageSession/WebVisit/
 * ContentBlockEvent/BreakSession/ProximityEvent/PrayerReminderEvent), so
 * omitting it here made it the one general-retention class a parent's
 * Section 6 "Delete now" request could never name: retentionRoutes.ts's
 * parseDeleteNowRecords validates every caller-supplied entityClass against
 * ALL_RETENTION_ENTITY_CLASSES below and rejected it as unknown. It is a
 * Section 3.1 general entity, NOT a Section 3.2-protected one, so it takes
 * the ordinary generalWindow like its siblings (resolveEffectiveWindow's
 * default arm) -- no engine/policy change is needed or wanted.
 * `SYNC_RECEIPT` covers PolicyReceipt/RetentionReceipt-shaped local status
 * records (doc 10 Section 5) -- non-sensitive completion metadata, not the
 * family-control message itself. `CHILD_REQUEST_DECISION` and
 * `ROUTINE_ACTIVITY` are this module's own names for doc 11 Section 3.1's
 * "child request/decision records" and "non-essential routine device
 * activity not otherwise itemized" respectively -- doc 10 does not assign
 * either a dedicated entity name. `WELLBEING_COUNTER` is forward modeling
 * for a not-yet-specified aggregate wellbeing metric; it carries no
 * doc 10/11 citation and should be revisited once such a feature is
 * actually specified.
 */
export type GeneralRetentionEntityClass =
  | 'WEB_VISIT'
  | 'CONTENT_BLOCK_EVENT'
  | 'USAGE_SESSION'
  | 'YOUTUBE_CONTROLLED_ACTIVITY'
  | 'BREAK_SESSION'
  | 'PROXIMITY_EVENT'
  | 'LOCATION_POINT'
  | 'PRAYER_REMINDER_EVENT'
  | 'INSTALLED_APP_EVENT'
  | 'ROUTINE_ACTIVITY'
  | 'CHILD_REQUEST_DECISION'
  | 'SYNC_RECEIPT'
  | 'WELLBEING_COUNTER';

/** doc 11 Section 3.3 -- own longer-lived floor, exempt from ordinary retention cycling AND from "Delete now" (both are Section 3.1-scoped only). */
export type AuditRetentionEntityClass = 'PARENT_ACTION_AUDIT' | 'TAMPER_EVENT';

export type RetentionEntityClass = GeneralRetentionEntityClass | AuditRetentionEntityClass;

/**
 * PCA-DATA-020: the type-level restriction above (RetentionEntityClass has
 * no member for any Section 3.2-protected entity) only holds INSIDE this
 * module's own pure functions -- it cannot by itself stop an external HTTP
 * caller from supplying an arbitrary string (e.g. `"Family"` or
 * `"DeviceKeyMetadata"`) that TypeScript's structural `as` casts at a JSON
 * parse boundary would happily let through un-checked. This runtime array
 * (generated FROM the exact same literal union above, not independently
 * maintained, so it can never drift out of sync with it) is what an HTTP
 * intake boundary must validate every caller-supplied `entityClass` against
 * before constructing a `RetentionRecord` -- see
 * http/routes/retentionRoutes.ts's `parseDeleteNowRecords`.
 */
export const ALL_RETENTION_ENTITY_CLASSES: readonly RetentionEntityClass[] = [
  'WEB_VISIT',
  'CONTENT_BLOCK_EVENT',
  'USAGE_SESSION',
  'YOUTUBE_CONTROLLED_ACTIVITY',
  'BREAK_SESSION',
  'PROXIMITY_EVENT',
  'LOCATION_POINT',
  'PRAYER_REMINDER_EVENT',
  'INSTALLED_APP_EVENT',
  'ROUTINE_ACTIVITY',
  'CHILD_REQUEST_DECISION',
  'SYNC_RECEIPT',
  'WELLBEING_COUNTER',
  'PARENT_ACTION_AUDIT',
  'TAMPER_EVENT',
];

export function isRetentionEntityClass(value: unknown): value is RetentionEntityClass {
  return typeof value === 'string' && (ALL_RETENTION_ENTITY_CLASSES as readonly string[]).includes(value);
}

export type LocationRetentionMode = 'CURRENT_LAST_ONLY' | { window: RetentionWindow };

export interface RetentionPolicySettings {
  generalWindow: RetentionWindow;
  locationMode: LocationRetentionMode;
  timezone: string;
}

export interface RetentionRecord {
  entityClass: RetentionEntityClass;
  id: string;
  eventTimestampUtc: Date;
}

export type DeletionState =
  | 'ACTIVE'
  | 'EXPIRY_DUE'
  | 'DELETE_REQUESTED'
  | 'DELETED_LOCAL'
  | 'DELETION_CONFIRMED'
  | 'DELETE_PENDING_REMOTE_DEVICE';

/** `exportExistsExternally` is an ADDITIVE tag (doc 11 Section 5.1), never exclusive with `state` -- a record can be DELETION_CONFIRMED locally while a prior export of it still exists outside app-managed storage. */
export interface DeletionRecordState {
  entityClass: RetentionEntityClass;
  id: string;
  state: DeletionState;
  exportExistsExternally: boolean;
}
