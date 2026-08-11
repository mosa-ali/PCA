/**
 * IANA weekday numbering used throughout this module: 0 = Sunday .. 6 =
 * Saturday, matching `Date.prototype.getDay` in UTC so window-matching
 * arithmetic never needs a separate convention translation.
 */
export type WeekdayIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface ZonedWallClock {
  weekday: WeekdayIndex;
  hour: number;
  minute: number;
  /** Calendar date in the target timezone, `YYYY-MM-DD`, used as the daily-limit reset anchor -- deliberately NOT derived from the UTC calendar date, which can differ from the family's local date near midnight. */
  localDate: string;
}

const WEEKDAY_INDEX: Record<string, WeekdayIndex> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/**
 * Resolves the wall-clock weekday/hour/minute/local-date for `instant` in
 * `timeZone`, delegating DST/offset handling entirely to the ICU data
 * behind `Intl.DateTimeFormat` rather than hand-rolled offset math -- this
 * is what makes DST and timezone-change behavior correct "for free".
 * Throws on an unrecognized IANA zone rather than silently falling back to
 * UTC, since a silent fallback would misapply bedtime/school-mode windows.
 */
export function toZonedWallClock(instant: Date, timeZone: string): ZonedWallClock {
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'short',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
  } catch {
    throw new RangeError(`Unrecognized IANA timezone: ${timeZone}`);
  }
  const parts = formatter.formatToParts(instant);
  const get = (type: string): string => {
    const part = parts.find((candidate) => candidate.type === type);
    if (!part) throw new RangeError(`Timezone formatter did not produce a "${type}" part.`);
    return part.value;
  };
  const weekday = WEEKDAY_INDEX[get('weekday')];
  if (weekday === undefined) throw new RangeError(`Unrecognized weekday token: ${get('weekday')}`);
  return {
    weekday,
    hour: Number(get('hour')) % 24,
    minute: Number(get('minute')),
    localDate: `${get('year')}-${get('month')}-${get('day')}`,
  };
}

export function minutesOfDay(hour: number, minute: number): number {
  return hour * 60 + minute;
}
