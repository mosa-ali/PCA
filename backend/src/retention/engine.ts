import { computeCalendarMonthExpiryInstant, computeFixedIntervalExpiryInstant } from './calendar.js';
import { compareRetentionWindows, effectiveAuditRetentionMonths, isAuditEntityClass, monthsForWindow } from './policy.js';
import type { RetentionEntityClass, RetentionPolicySettings, RetentionRecord, RetentionWindow } from './types.js';

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

export type PolicyValidationError = 'LOCATION_WINDOW_EXCEEDS_GENERAL';

/** PCA-DATA-022: location retention may be shorter-or-equal to the general window, never longer. `CURRENT_LAST_ONLY` is always valid (strictly stricter than any window). */
export function validateRetentionPolicy(policy: RetentionPolicySettings): PolicyValidationError[] {
  if (policy.locationMode === 'CURRENT_LAST_ONLY') return [];
  if (compareRetentionWindows(policy.locationMode.window, policy.generalWindow) > 0) {
    return ['LOCATION_WINDOW_EXCEEDS_GENERAL'];
  }
  return [];
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
export function planPurge(records: RetentionRecord[], policy: RetentionPolicySettings, nowUtc: Date): PurgePlan {
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
      toDelete.push({ entityClass: record.entityClass, id: record.id, reason: 'EXPIRED' });
    }
  }

  if (byLocationRecord.length > 0) {
    const mostRecent = byLocationRecord.reduce((best, candidate) =>
      candidate.eventTimestampUtc.getTime() > best.eventTimestampUtc.getTime() ? candidate : best,
    );
    for (const record of byLocationRecord) {
      if (record.id !== mostRecent.id) {
        toDelete.push({ entityClass: record.entityClass, id: record.id, reason: 'ROLLING_RETENTION_SUPERSEDED' });
      }
    }
  }

  return { toDelete, retainedCount: records.length - toDelete.length };
}

/** Export inclusion filter (PCA-12 brief Section 29 "retention-expired data excluded from export"): reuses the exact same expiry rule planPurge uses, so a record already purge-eligible at export time is never bundled into an export. Rolling CURRENT_LAST_ONLY location records are handled the same way planPurge handles them -- only the single most-recent point is export-eligible. */
export function filterNonExpiredForExport(records: RetentionRecord[], policy: RetentionPolicySettings, nowUtc: Date): RetentionRecord[] {
  const plan = planPurge(records, policy, nowUtc);
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
export function planDeleteNow(records: RetentionRecord[]): PurgePlan {
  const toDelete: PurgePlanEntry[] = [];
  for (const record of records) {
    if (isAuditEntityClass(record.entityClass)) continue;
    toDelete.push({ entityClass: record.entityClass, id: record.id, reason: 'DELETE_NOW' });
  }
  return { toDelete, retainedCount: records.length - toDelete.length };
}
