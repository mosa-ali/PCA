package org.pca.app.feature.prayer.schedule

import org.pca.app.feature.prayer.model.PrayerName
import java.time.Duration
import java.time.ZonedDateTime

data class NextPrayerInfo(
    val prayer: PrayerName,
    val at: ZonedDateTime,
    val remaining: Duration,
)

/**
 * Resolves the next upcoming prayer (excluding [PrayerName.SUNRISE], which is a calculation
 * anchor, not a prayer) relative to [now]. Callers pass both today's and tomorrow's schedules
 * so the resolver can correctly roll over past midnight once the last prayer of the day (Isha)
 * has passed.
 */
object NextPrayerResolver {

    fun resolve(
        now: ZonedDateTime,
        todaySchedule: DailyPrayerSchedule,
        tomorrowSchedule: DailyPrayerSchedule,
    ): NextPrayerInfo? {
        val upcomingToday = candidates(todaySchedule).filter { (_, at) -> at.isAfter(now) }
        val upcomingTomorrow = candidates(tomorrowSchedule)

        val next = (upcomingToday + upcomingTomorrow).minByOrNull { (_, at) -> at.toInstant() } ?: return null
        return NextPrayerInfo(prayer = next.first, at = next.second, remaining = Duration.between(now, next.second))
    }

    private fun candidates(schedule: DailyPrayerSchedule): List<Pair<PrayerName, ZonedDateTime>> =
        PrayerName.entries
            .filter { it.isPrayer }
            .mapNotNull { prayer -> schedule.time(prayer)?.let { prayer to it } }
}
