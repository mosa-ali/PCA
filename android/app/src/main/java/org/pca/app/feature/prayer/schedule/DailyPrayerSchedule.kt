package org.pca.app.feature.prayer.schedule

import org.pca.app.feature.prayer.model.PrayerName
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZonedDateTime

/**
 * A single calendar day's prayer schedule in [zoneId]. A `null` entry means the event has no
 * solution on this date/latitude combination (midnight sun / polar night) rather than a crash —
 * astronomically correct, if rare in practice.
 */
data class DailyPrayerSchedule(
    val date: LocalDate,
    val zoneId: ZoneId,
    val times: Map<PrayerName, ZonedDateTime?>,
) {
    fun time(prayer: PrayerName): ZonedDateTime? = times[prayer]
}
