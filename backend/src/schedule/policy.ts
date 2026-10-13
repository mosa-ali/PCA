import { minutesOfDay, toZonedWallClock, type ZonedWallClock } from './timezone.js';
import type { AppScope, ScheduleWindow } from './types.js';

const scheduleWindowKinds = new Set(['BEDTIME', 'SCHOOL_MODE', 'ALLOW_PERIOD', 'BLOCK_PERIOD']);

export function appScopeIncludes(scope: AppScope, appToken: string): boolean {
  if (scope === 'ALL') return true;
  return typeof scope === 'object' && scope !== null && !Array.isArray(scope) &&
    Array.isArray(scope.apps) && scope.apps.includes(appToken);
}

/** Validate the runtime shape of a policy scope before evaluation. Serialized
 * or persisted policy may not satisfy this module's static TypeScript types. */
export function validateAppScope(scope: unknown, description: string): string[] {
  if (scope === 'ALL') return [];
  if (typeof scope !== 'object' || scope === null || Array.isArray(scope)) {
    return [`${description} appScope must be ALL or an app list`];
  }
  const apps = (scope as { apps?: unknown }).apps;
  if (!Array.isArray(apps) || apps.some((token) => typeof token !== 'string' || token.length === 0)) {
    return [`${description} appScope must contain non-empty app tokens`];
  }
  return [];
}

export function validateScheduleWindow(window: ScheduleWindow): string[] {
  if (typeof window !== 'object' || window === null || Array.isArray(window)) {
    return ['schedule window must be an object'];
  }
  const errors: string[] = [];
  if (typeof window.kind !== 'string' || !scheduleWindowKinds.has(window.kind)) {
    errors.push(`window ${window.id ?? '(unknown)'}: invalid kind`);
  }
  errors.push(...validateAppScope(window?.appScope, `window ${window?.id ?? '(unknown)'}`));
  for (const [label, tod] of [
    ['start', window.start],
    ['end', window.end],
  ] as const) {
    if (typeof tod !== 'object' || tod === null || Array.isArray(tod)) {
      errors.push(`window ${window.id}: ${label} must be a time-of-day object`);
      continue;
    }
    if (!Number.isInteger(tod.hour) || tod.hour < 0 || tod.hour > 23) {
      errors.push(`window ${window.id}: ${label}.hour out of range`);
    }
    if (!Number.isInteger(tod.minute) || tod.minute < 0 || tod.minute > 59) {
      errors.push(`window ${window.id}: ${label}.minute out of range`);
    }
  }
  if (!Array.isArray(window.daysOfWeek)) {
    errors.push(`window ${window.id}: daysOfWeek must be an array`);
  } else if (window.daysOfWeek.length === 0) {
    errors.push(`window ${window.id}: daysOfWeek must not be empty`);
  }
  for (const day of Array.isArray(window.daysOfWeek) ? window.daysOfWeek : []) {
    if (!Number.isInteger(day) || day < 0 || day > 6) {
      errors.push(`window ${window.id}: invalid daysOfWeek entry ${day}`);
    }
  }
  try {
    if (typeof window.timezone !== 'string' || window.timezone.length === 0) throw new Error('invalid timezone');
    toZonedWallClock(new Date(), window.timezone);
  } catch {
    errors.push(`window ${window.id}: invalid timezone ${window.timezone}`);
  }
  return errors;
}

/**
 * True when `nowUtc` falls inside `window`, evaluated in the window's own
 * authored timezone. A window whose end-of-day minutes is not strictly
 * after its start-of-day minutes is treated as crossing midnight: it is
 * active either during [start, 24:00) on a matching start day, or during
 * [00:00, end) on the calendar day immediately after a matching start day.
 */
export function isWindowActive(window: ScheduleWindow, nowUtc: Date): boolean {
  const zoned = toZonedWallClock(nowUtc, window.timezone);
  const nowMinutes = minutesOfDay(zoned.hour, zoned.minute);
  const startMinutes = minutesOfDay(window.start.hour, window.start.minute);
  const endMinutes = minutesOfDay(window.end.hour, window.end.minute);

  if (endMinutes > startMinutes) {
    return window.daysOfWeek.includes(zoned.weekday) && nowMinutes >= startMinutes && nowMinutes < endMinutes;
  }

  const todayIsStartDay = window.daysOfWeek.includes(zoned.weekday) && nowMinutes >= startMinutes;
  const yesterdayWeekday = ((zoned.weekday + 6) % 7) as ZonedWallClock['weekday'];
  const yesterdayWasStartDay = window.daysOfWeek.includes(yesterdayWeekday) && nowMinutes < endMinutes;
  return todayIsStartDay || yesterdayWasStartDay;
}
