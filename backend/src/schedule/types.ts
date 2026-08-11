import type { WeekdayIndex } from './timezone.js';

export type OpaqueAppToken = string;
export type AppScope = 'ALL' | { apps: OpaqueAppToken[] };

export interface TimeOfDay {
  hour: number;
  minute: number;
}

export type ScheduleWindowKind = 'BEDTIME' | 'SCHOOL_MODE' | 'ALLOW_PERIOD' | 'BLOCK_PERIOD';

/**
 * A recurring time-of-day window (PCA-FR-043). `daysOfWeek` lists the
 * weekdays the window's START falls on; a window whose `end` is not after
 * `start` is interpreted as crossing midnight into the following calendar
 * day (e.g. bedtime 21:00 -> 07:00), still anchored to the day `start`
 * falls on for `daysOfWeek` matching.
 */
export interface ScheduleWindow {
  id: string;
  kind: ScheduleWindowKind;
  daysOfWeek: WeekdayIndex[];
  start: TimeOfDay;
  end: TimeOfDay;
  appScope: AppScope;
  /** IANA timezone the window's start/end are authored in (PCA-FR-091 "per-child policy pages" are set in the family's configured timezone, which may differ from the device's current timezone after travel). */
  timezone: string;
}

/** PCA-FR-016: parent-granted or child-requested-and-approved extra time, additive on top of a daily limit. Expiry is an absolute UTC instant, never a wall-clock/local-time comparison, so it cannot be extended by manipulating device time zone. */
export interface BonusGrant {
  id: string;
  appScope: AppScope;
  extraMinutes: number;
  grantedAtUtc: Date;
  expiresAtUtc: Date;
}

/** PCA-FR-043A: a parent-approved temporary exception that overrides an active locked window (bedtime/school mode) for its stated duration. */
export interface ParentException {
  id: string;
  appScope: AppScope;
  startAtUtc: Date;
  endAtUtc: Date;
  reason: string;
}

/** PCA-FR-041. `anchorLocalDate` is the family-local calendar date (from toZonedWallClock) the `usedMinutesToday` figure was accumulated against; the engine treats a mismatch against the evaluation instant's local date as an implicit reset, it never mutates this record itself. */
export interface DailyAppLimit {
  appScope: AppScope;
  limitMinutes: number;
  usedMinutesToday: number;
  anchorLocalDate: string;
}

export type EnforcementCapabilityState = 'ENFORCED' | 'DEGRADED' | 'UNAVAILABLE';

export type ScheduleDecisionKind =
  | 'ALLOWED'
  | 'ALLOWED_BONUS'
  | 'ALLOWED_EXCEPTION'
  | 'BLOCKED_BEDTIME'
  | 'BLOCKED_SCHOOL_MODE'
  | 'BLOCKED_PERIOD'
  | 'BLOCKED_OUTSIDE_ALLOW_PERIOD'
  | 'BLOCKED_LIMIT_REACHED'
  | 'ENFORCEMENT_UNAVAILABLE'
  | 'INVALID_CONFIG';

export interface ScheduleDecision {
  decision: ScheduleDecisionKind;
  reason: string;
  /** The window that produced a BLOCKED_ or ALLOWED_EXCEPTION verdict, when applicable. For SCHOOL_MODE, this is the lexicographically-first id in matchedWindowIds -- a stable pick, never insertion order. */
  matchedWindowId?: string;
  /** All windows that jointly produced the verdict, when more than one contributed (currently only BLOCKED_SCHOOL_MODE with multiple simultaneously-active school-mode windows). Sorted by id, never by array/insertion order. */
  matchedWindowIds?: string[];
  /** Present only for ENFORCEMENT_UNAVAILABLE: what the engine would otherwise have decided, so the UI can show an honest "should be X, cannot confirm enforcement" state rather than a bare unknown. */
  intendedDecision?: ScheduleDecisionKind;
  remainingMinutesToday?: number;
  configErrors?: string[];
}

export interface ScheduleEvaluationInput {
  nowUtc: Date;
  timezone: string;
  appToken: OpaqueAppToken;
  windows: ScheduleWindow[];
  bonusGrants: BonusGrant[];
  exceptions: ParentException[];
  dailyLimit?: DailyAppLimit;
  enforcementCapability: EnforcementCapabilityState;
  connectivity: 'ONLINE' | 'OFFLINE';
  /** Last instant the device confirmed its policy set (windows/bonus/exceptions) was current with the parent-authored source. Used only to label offline evaluation honestly; policy enforcement itself never pauses just because the device is offline (PCA-FR-017 spirit: don't silently relax control when disconnected). */
  lastPolicySyncAtUtc: Date | null;
}
