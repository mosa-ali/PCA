/**
 * doc 11 Section 5.1/PCA-DATA-030: "14 days" is an exact 14*24h elapsed
 * interval (pure UTC arithmetic, immune to timezone/DST by construction).
 * "1/3/6/9 months" are CALENDAR-month intervals computed in the family's
 * policy timezone, then converted back to a UTC instant -- so a policy
 * window is anchored to the family's own local calendar day/time, not to
 * an arbitrary UTC-day approximation.
 */

interface ZonedDateTime {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function toZonedDateTime(instant: Date, timeZone: string): ZonedDateTime {
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
  } catch {
    throw new RangeError(`Unrecognized IANA timezone: ${timeZone}`);
  }
  const parts = formatter.formatToParts(instant);
  const get = (type: string): number => {
    const part = parts.find((candidate) => candidate.type === type);
    if (!part) throw new RangeError(`Timezone formatter did not produce a "${type}" part.`);
    return Number(part.value);
  };
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour') % 24, minute: get('minute'), second: get('second') };
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Adds calendar months, clamping the day to the target month's last day when the source day doesn't exist there (doc 11: "if the target month lacks the source day, use that month's final day at the corresponding local time"). */
function addCalendarMonths(zoned: ZonedDateTime, monthsToAdd: number): ZonedDateTime {
  const totalMonths = zoned.year * 12 + (zoned.month - 1) + monthsToAdd;
  const year = Math.floor(totalMonths / 12);
  const month = (totalMonths % 12) + 1;
  const day = Math.min(zoned.day, daysInMonth(year, month));
  return { year, month, day, hour: zoned.hour, minute: zoned.minute, second: zoned.second };
}

/**
 * Resolves the UTC instant that formats, in `timeZone`, to exactly
 * `target`. Iterative offset correction: a naive Date.UTC guess is
 * refined against the ACTUAL offset the target date/time falls under (not
 * the offset at the guess), which is what makes this correct across a DST
 * boundary the naive guess crosses. Converges in at most a couple of
 * passes for an ordinary single offset change. The rare residual case --
 * a target wall-clock value that does not exist (a spring-forward gap) or
 * exists twice (a fall-back overlap), because a DST transition lands
 * exactly on the target minute -- resolves to Intl's own disambiguated
 * interpretation of the final guess, which is always SOME valid instant,
 * but is NOT guaranteed to be the earlier of the two candidates: hand
 * verification shows a gap-case target can resolve up to one hour LATER
 * than a naive same-offset calculation would (RED-TEAM finding, retained
 * here rather than silently fixed -- the corrected claim is: any DST
 * imprecision here is bounded to at most the transition's own offset
 * delta, normally one hour, which is immaterial against every supported
 * retention window (minimum 14 days) and is exactly the same bounded
 * tolerance this module's own DST test already asserts). This function
 * does not, and cannot, guarantee zero DST-driven variance in the rare
 * gap/overlap-landing case -- only that the variance stays within one
 * transition's offset delta, never compounding or drifting further.
 */
function resolveZonedInstant(target: ZonedDateTime, timeZone: string): Date {
  const targetMs = Date.UTC(target.year, target.month - 1, target.day, target.hour, target.minute, target.second);
  let guessMs = targetMs;
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const observed = toZonedDateTime(new Date(guessMs), timeZone);
    const observedMs = Date.UTC(observed.year, observed.month - 1, observed.day, observed.hour, observed.minute, observed.second);
    const diff = targetMs - observedMs;
    if (diff === 0) break;
    guessMs += diff;
  }
  return new Date(guessMs);
}

export function computeFixedIntervalExpiryInstant(eventTimestampUtc: Date, days: number): Date {
  return new Date(eventTimestampUtc.getTime() + days * 24 * 60 * 60 * 1000);
}

export function computeCalendarMonthExpiryInstant(eventTimestampUtc: Date, timeZone: string, months: number): Date {
  const zoned = toZonedDateTime(eventTimestampUtc, timeZone);
  const target = addCalendarMonths(zoned, months);
  return resolveZonedInstant(target, timeZone);
}
