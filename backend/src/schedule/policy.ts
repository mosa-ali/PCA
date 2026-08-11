import { minutesOfDay, toZonedWallClock, type ZonedWallClock } from './timezone.js';
import type { AppScope, ScheduleWindow } from './types.js';

export function appScopeIncludes(scope: AppScope, appToken: string): boolean {
  return scope === 'ALL' || scope.apps.includes(appToken);
}

export function validateScheduleWindow(window: ScheduleWindow): string[] {
  const errors: string[] = [];
  for (const [label, tod] of [
    ['start', window.start],
    ['end', window.end],
  ] as const) {
    if (!Number.isInteger(tod.hour) || tod.hour < 0 || tod.hour > 23) {
      errors.push(`window ${window.id}: ${label}.hour out of range`);
    }
    if (!Number.isInteger(tod.minute) || tod.minute < 0 || tod.minute > 59) {
      errors.push(`window ${window.id}: ${label}.minute out of range`);
    }
  }
  if (window.daysOfWeek.length === 0) {
    errors.push(`window ${window.id}: daysOfWeek must not be empty`);
  }
  for (const day of window.daysOfWeek) {
    if (!Number.isInteger(day) || day < 0 || day > 6) {
      errors.push(`window ${window.id}: invalid daysOfWeek entry ${day}`);
    }
  }
  try {
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
