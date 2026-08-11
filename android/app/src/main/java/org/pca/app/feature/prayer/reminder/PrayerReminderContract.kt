package org.pca.app.feature.prayer.reminder

import org.pca.app.feature.prayer.model.PrayerName
import org.pca.app.feature.prayer.schedule.DailyPrayerSchedule
import java.time.Duration
import java.time.ZonedDateTime

/** A single, deterministically computed reminder — pure data, no scheduling side effect. */
data class ReminderPlan(
    val prayer: PrayerName,
    val prayerAt: ZonedDateTime,
    val remindAt: ZonedDateTime,
)

/**
 * Deterministic reminder planning, kept fully separate from Android alarm scheduling per the
 * platform-dependency boundary: this produces plain data describing *when* a reminder should
 * fire, with no dependency on `AlarmManager`/`WorkManager`. The coordinator binds a
 * [PrayerAlarmScheduler] adapter that turns a [ReminderPlan] into an actual OS alarm.
 */
object ReminderPlanner {
    fun buildPlan(schedule: DailyPrayerSchedule, leadTime: Duration): List<ReminderPlan> =
        PrayerName.entries
            .filter { it.isPrayer }
            .mapNotNull { prayer ->
                schedule.time(prayer)?.let { at -> ReminderPlan(prayer = prayer, prayerAt = at, remindAt = at.minus(leadTime)) }
            }
}

/**
 * Narrow port for the platform-specific alarm scheduling PCA-3/PCA-9 must not implement
 * directly (see the platform-dependency boundary: adapters are bound by the coordinator
 * during integration, not by this feature package).
 */
interface PrayerAlarmScheduler {
    fun scheduleReminder(plan: ReminderPlan)
    fun cancelReminder(prayer: PrayerName)
    fun cancelAll()
}
