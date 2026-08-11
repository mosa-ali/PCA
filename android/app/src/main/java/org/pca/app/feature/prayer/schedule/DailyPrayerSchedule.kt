package org.pca.app.feature.prayer.schedule

import org.pca.app.feature.prayer.model.PrayerName
import org.pca.app.feature.prayer.model.PrayerTimeOutcome
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZonedDateTime

/**
 * A single calendar day's prayer schedule in [zoneId]. Every prayer maps to an explicit
 * [PrayerTimeOutcome] — either a resolved instant or [PrayerTimeOutcome.NeedsFamilyChoice] —
 * never a bare null, so "we couldn't compute this" is never silently indistinguishable from a
 * missing map entry.
 */
data class DailyPrayerSchedule(
    val date: LocalDate,
    val zoneId: ZoneId,
    val outcomes: Map<PrayerName, PrayerTimeOutcome>,
) {
    fun outcome(prayer: PrayerName): PrayerTimeOutcome = outcomes.getValue(prayer)

    /** Convenience accessor for callers that only care about resolved times; `null` covers both
     * an unresolved outcome and [PrayerTimeOutcome.NeedsFamilyChoice] alike. */
    fun time(prayer: PrayerName): ZonedDateTime? = (outcomes[prayer] as? PrayerTimeOutcome.Resolved)?.at
}
