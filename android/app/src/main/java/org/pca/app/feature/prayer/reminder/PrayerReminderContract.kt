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

    /**
     * PPR1R-D005: the NEXT still-future reminder for each prayer, taken from [today] if that
     * prayer's reminder has not passed yet and otherwise from [tomorrow] — at most one plan per
     * prayer, never a past one.
     *
     * "At most one per prayer" is not a stylistic choice: the OS-alarm adapter derives one
     * `PendingIntent` request code per [PrayerName], so a second plan for the same prayer would
     * silently REPLACE the first rather than add to it. Producing the single next occurrence here
     * makes that one-alarm-per-prayer reality explicit in the planning layer instead of leaving
     * the adapter to quietly discard extras.
     *
     * Still pure data with no scheduling side effect, exactly like [buildPlan] — the caller
     * supplies [now] rather than this object reading a clock.
     */
    fun nextPlans(
        today: DailyPrayerSchedule,
        tomorrow: DailyPrayerSchedule,
        leadTime: Duration,
        now: ZonedDateTime,
    ): List<ReminderPlan> {
        val todayByPrayer = buildPlan(today, leadTime).associateBy { it.prayer }
        val tomorrowByPrayer = buildPlan(tomorrow, leadTime).associateBy { it.prayer }
        return PrayerName.entries
            .filter { it.isPrayer }
            .mapNotNull { prayer ->
                todayByPrayer[prayer]?.takeIf { it.remindAt.isAfter(now) }
                    ?: tomorrowByPrayer[prayer]?.takeIf { it.remindAt.isAfter(now) }
            }
    }
}

/**
 * PPR1R-D005: the honest result of asking the platform to arm ONE [ReminderPlan].
 *
 * [PrayerAlarmScheduler.scheduleReminder] used to return `Unit`, so an adapter that could not
 * schedule anything (API 31+ `SCHEDULE_EXACT_ALARM` special access not granted, or revoked
 * between the check and the call) was indistinguishable from one that had armed a real alarm.
 * That is exactly the shape of silent inertness this enum exists to make impossible: a caller now
 * has to look at the outcome, and the coordinator that does so surfaces a not-permitted state
 * through the same tamper-event + capability-alert path every other lost-capability signal in
 * this app already uses.
 */
enum class ReminderScheduleOutcome {
    /** A real OS alarm is now armed for this plan. */
    SCHEDULED,

    /**
     * The platform refused to arm an exact alarm: on API 31+ the app's `SCHEDULE_EXACT_ALARM`
     * special access is not currently granted (or was revoked between the capability check and
     * the call). Recoverable by the user in Settings — never a permanent condition.
     */
    EXACT_ALARMS_NOT_PERMITTED,

    /** The platform did not provide an alarm service at all; nothing can be armed on this device. */
    ALARM_SERVICE_UNAVAILABLE,
}

/**
 * Narrow port for the platform-specific alarm scheduling PCA-3/PCA-9 must not implement
 * directly (see the platform-dependency boundary: adapters are bound by the coordinator
 * during integration, not by this feature package).
 */
interface PrayerAlarmScheduler {
    fun scheduleReminder(plan: ReminderPlan): ReminderScheduleOutcome
    fun cancelReminder(prayer: PrayerName)
    fun cancelAll()
}
