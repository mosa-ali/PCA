import { computeCalendarMonthExpiryInstant, computeFixedIntervalExpiryInstant } from './calendar.js';
import { compareRetentionWindows, effectiveAuditRetentionMonths, isAuditEntityClass, isRetentionWindow, isValidPolicyTimezone, monthsForWindow } from './policy.js';
import type { RetentionEntityClass, RetentionPolicySettings, RetentionRecord, RetentionWindow } from './types.js';
import { translate } from '../i18n/translate.js';
import type { SupportedLocale } from '../i18n/types.js';

/** Computes the UTC instant a single record with the given window becomes expired (doc 11 Section 5.1). Pure; no current-time dependency. */
export function computeExpiryInstant(eventTimestampUtc: Date, timeZone: string, window: RetentionWindow): Date {
  if (window === '14_DAYS') return computeFixedIntervalExpiryInstant(eventTimestampUtc, 14);
  const months = monthsForWindow(window);
  if (months === null) throw new RangeError(`Unrecognized retention window: ${window}`);
  return computeCalendarMonthExpiryInstant(eventTimestampUtc, timeZone, months);
}

/** PCA-DATA-021 "whichever is longer": floor is max(generalWindow-in-months, 12). With today's option set (max general window = 9 months) this always resolves to 12 -- but it genuinely recomputes from `generalWindow` rather than hardcoding 12, so a future wider general-window option is handled correctly without a silent audit-retention regression. */
function computeAuditExpiryInstant(eventTimestampUtc: Date, timeZone: string, generalWindow: RetentionWindow): Date {
  return computeCalendarMonthExpiryInstant(eventTimestampUtc, timeZone, effectiveAuditRetentionMonths(generalWindow));
}

export function isExpired(expiryInstant: Date, nowUtc: Date): boolean {
  return nowUtc.getTime() >= expiryInstant.getTime();
}

export type PolicyValidationError =
  | 'INVALID_GENERAL_WINDOW'
  | 'INVALID_LOCATION_WINDOW'
  | 'INVALID_TIMEZONE'
  | 'LOCATION_WINDOW_EXCEEDS_GENERAL';

/** PCA-DATA-022: location retention may be shorter-or-equal to the general window, never longer. `CURRENT_LAST_ONLY` is always valid (strictly stricter than any window). */
export function validateRetentionPolicy(policy: RetentionPolicySettings): PolicyValidationError[] {
  const errors: PolicyValidationError[] = [];
  if (!isRetentionWindow(policy.generalWindow)) errors.push('INVALID_GENERAL_WINDOW');
  if (!isValidPolicyTimezone(policy.timezone)) errors.push('INVALID_TIMEZONE');
  if (policy.locationMode !== 'CURRENT_LAST_ONLY' && !isRetentionWindow(policy.locationMode.window)) {
    errors.push('INVALID_LOCATION_WINDOW');
  }
  if (
    errors.length === 0 &&
    policy.locationMode !== 'CURRENT_LAST_ONLY' &&
    compareRetentionWindows(policy.locationMode.window, policy.generalWindow) > 0
  ) {
    errors.push('LOCATION_WINDOW_EXCEEDS_GENERAL');
  }
  return errors;
}

export function resolveEffectiveWindow(entityClass: RetentionEntityClass, policy: RetentionPolicySettings): RetentionWindow | 'CURRENT_LAST_ONLY' | 'AUDIT_FLOOR' {
  if (isAuditEntityClass(entityClass)) return 'AUDIT_FLOOR';
  if (entityClass === 'LOCATION_POINT') {
    return policy.locationMode === 'CURRENT_LAST_ONLY' ? 'CURRENT_LAST_ONLY' : policy.locationMode.window;
  }
  return policy.generalWindow;
}

export interface PurgePlanEntry {
  entityClass: RetentionEntityClass;
  id: string;
  reason: 'EXPIRED' | 'ROLLING_RETENTION_SUPERSEDED' | 'DELETE_NOW';
  /**
   * doc 20 PCA-FR-113 "deletion confirmations must be localized": the
   * genuine, presentation-ready deletion-confirmation text for `reason`,
   * resolved via i18n's translate() against the locale the caller supplied
   * to planPurge/planDeleteNow (default 'en'). `reason` itself remains the
   * stable machine-readable code -- this field is the ADDITIONAL localized
   * text, never a replacement for it, so existing callers keying off
   * `reason` are unaffected.
   */
  reasonMessage: string;
}

export interface PurgePlan {
  toDelete: PurgePlanEntry[];
  retainedCount: number;
}

/**
 * Batch purge planning (doc 11 Section 5 steps 1-2). Pure: given the
 * FULL current record set, the policy, and `nowUtc`, decides which
 * records are purge-eligible right now. Never touches audit-floor
 * entities differently from their own dedicated floor rule (PCA-DATA-021),
 * and structurally cannot reference a Section 3.2-protected entity since
 * RetentionEntityClass has no member for one (see types.ts).
 *
 * LOCATION_POINT under CURRENT_LAST_ONLY uses a rolling-retention rule
 * (keep only the single most-recent point) instead of expiry-based
 * purging -- independent of `nowUtc`, so it purges immediately on the
 * next planning pass regardless of the superseded point's age.
 */
export function planPurge(records: RetentionRecord[], policy: RetentionPolicySettings, nowUtc: Date, locale: SupportedLocale = 'en'): PurgePlan {
  const policyViolations = validateRetentionPolicy(policy);
  if (policyViolations.length > 0) {
    throw new RangeError(`Invalid retention policy: ${policyViolations.join(', ')}`);
  }
  if (!(nowUtc instanceof Date) || !Number.isFinite(nowUtc.getTime())) {
    throw new RangeError('nowUtc must be a valid UTC instant.');
  }
  const toDelete: PurgePlanEntry[] = [];
  const byLocationRecord: RetentionRecord[] = [];

  for (const record of records) {
    if (record.entityClass === 'LOCATION_POINT' && policy.locationMode === 'CURRENT_LAST_ONLY') {
      byLocationRecord.push(record);
      continue;
    }
    const window = resolveEffectiveWindow(record.entityClass, policy);
    const expiryInstant =
      window === 'CURRENT_LAST_ONLY'
        ? null // unreachable given the branch above, kept for exhaustiveness
        : window === 'AUDIT_FLOOR'
          ? computeAuditExpiryInstant(record.eventTimestampUtc, policy.timezone, policy.generalWindow)
          : computeExpiryInstant(record.eventTimestampUtc, policy.timezone, window);
    if (expiryInstant && isExpired(expiryInstant, nowUtc)) {
      toDelete.push({ entityClass: record.entityClass, id: record.id, reason: 'EXPIRED', reasonMessage: translate('retention.EXPIRED', locale) });
    }
  }

  if (byLocationRecord.length > 0) {
    const mostRecent = byLocationRecord.reduce((best, candidate) =>
      candidate.eventTimestampUtc.getTime() > best.eventTimestampUtc.getTime() ? candidate : best,
    );
    for (const record of byLocationRecord) {
      if (record.id !== mostRecent.id) {
        toDelete.push({
          entityClass: record.entityClass,
          id: record.id,
          reason: 'ROLLING_RETENTION_SUPERSEDED',
          reasonMessage: translate('retention.ROLLING_RETENTION_SUPERSEDED', locale),
        });
      }
    }
  }

  return { toDelete, retainedCount: records.length - toDelete.length };
}

export function clonePurgePlan(plan: PurgePlan): PurgePlan {
  return {
    toDelete: plan.toDelete.map((entry) => ({ ...entry })),
    retainedCount: plan.retainedCount,
  };
}

/** Export inclusion filter (PCA-12 brief Section 29 "retention-expired data excluded from export"): reuses the exact same expiry rule planPurge uses, so a record already purge-eligible at export time is never bundled into an export. Rolling CURRENT_LAST_ONLY location records are handled the same way planPurge handles them -- only the single most-recent point is export-eligible. */
export function filterNonExpiredForExport(records: RetentionRecord[], policy: RetentionPolicySettings, nowUtc: Date, locale: SupportedLocale = 'en'): RetentionRecord[] {
  const plan = planPurge(records, policy, nowUtc, locale);
  const excludedIds = new Set(plan.toDelete.map((entry) => `${entry.entityClass}:${entry.id}`));
  return records.filter((record) => !excludedIds.has(`${record.entityClass}:${record.id}`));
}

/**
 * doc 11 Section 6 "Delete now": scoped to ALL Section 3.1 (general)
 * entities regardless of age, explicitly EXCLUDING audit-floor entities
 * (PARENT_ACTION_AUDIT/TAMPER_EVENT never get deleted by Delete Now --
 * only ordinary retention's own ineligibility, or the separate
 * family/device removal flow, ever removes them).
 */
export function planDeleteNow(records: RetentionRecord[], locale: SupportedLocale = 'en'): PurgePlan {
  const toDelete: PurgePlanEntry[] = [];
  const reasonMessage = translate('retention.DELETE_NOW', locale);
  for (const record of records) {
    if (isAuditEntityClass(record.entityClass)) continue;
    toDelete.push({ entityClass: record.entityClass, id: record.id, reason: 'DELETE_NOW', reasonMessage });
  }
  return { toDelete, retainedCount: records.length - toDelete.length };
}
