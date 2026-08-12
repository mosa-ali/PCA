package org.pca.app.runtime.schedule

import java.time.Instant
import java.time.ZoneId
import java.time.ZonedDateTime

/**
 * IANA weekday numbering used throughout this package: 0 = Sunday .. 6 = Saturday, matching
 * `java.util.Calendar.DAY_OF_WEEK - 1` / JS `Date.getDay()` conventions -- kept identical to
 * `backend/src/schedule/timezone.ts`'s `WeekdayIndex` so shared conformance vectors need no
 * per-runtime weekday translation.
 */
typealias WeekdayIndex = Int

data class ZonedWallClock(
    val weekday: WeekdayIndex,
    val hour: Int,
    val minute: Int,
    /** `YYYY-MM-DD` in the target timezone -- the daily-limit reset anchor. Deliberately not the
     * UTC calendar date, which can differ from the family's local date near midnight. */
    val localDate: String,
)

class InvalidScheduleTimezoneException(timeZone: String) : RuntimeException("Unrecognized IANA timezone: $timeZone")

/**
 * Resolves the wall-clock weekday/hour/minute/local-date for [instant] in [timeZone], delegating
 * DST/offset handling entirely to [java.time.ZoneId] -- the same "let the platform's tz database
 * do the work" approach as the TS reference's `Intl.DateTimeFormat` usage, which is what makes
 * DST and timezone-change behavior correct "for free" and keeps this evaluator a conforming
 * implementation rather than a re-derivation. Throws on an unrecognized IANA zone rather than
 * silently falling back to UTC, since a silent fallback would misapply bedtime/school-mode
 * windows.
 */
fun toZonedWallClock(instant: Instant, timeZone: String): ZonedWallClock {
    val zoneId = try {
        ZoneId.of(timeZone)
    } catch (e: Exception) {
        throw InvalidScheduleTimezoneException(timeZone)
    }
    val zoned: ZonedDateTime = instant.atZone(zoneId)
    // ISO weekday is 1=Monday..7=Sunday; convert to 0=Sunday..6=Saturday.
    val weekday = zoned.dayOfWeek.value % 7
    return ZonedWallClock(
        weekday = weekday,
        hour = zoned.hour,
        minute = zoned.minute,
        localDate = "%04d-%02d-%02d".format(zoned.year, zoned.monthValue, zoned.dayOfMonth),
    )
}

fun minutesOfDay(hour: Int, minute: Int): Int = hour * 60 + minute

internal fun isRecognizedTimezone(timeZone: String): Boolean = try {
    ZoneId.of(timeZone)
    true
} catch (e: Exception) {
    false
}
