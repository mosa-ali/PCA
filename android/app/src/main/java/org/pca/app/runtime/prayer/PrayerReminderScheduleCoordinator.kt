package org.pca.app.runtime.prayer

import java.time.Duration
import java.time.Instant
import java.time.ZoneId
import java.util.UUID
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.pca.app.feature.prayer.calc.PrayerTimeCalculator
import org.pca.app.feature.prayer.model.AsrMethod
import org.pca.app.feature.prayer.model.CalculationMethod
import org.pca.app.feature.prayer.model.Coordinates
import org.pca.app.feature.prayer.reminder.PrayerAlarmScheduler
import org.pca.app.feature.prayer.reminder.ReminderPlan
import org.pca.app.feature.prayer.reminder.ReminderPlanner
import org.pca.app.feature.prayer.reminder.ReminderScheduleOutcome
import org.pca.app.foundation.WallClockTimeSource
import org.pca.app.persistence.entity.PrayerDeliveryState
import org.pca.app.persistence.repository.PrayerReminderEventRepository
import org.pca.app.persistence.repository.TamperEventRepository

/**
 * PPR1R-D005: the missing production trigger for the prayer reminder subsystem.
 *
 * Every piece of that subsystem already existed and was individually correct --
 * [PrayerTimeCalculator] computes the day's times offline, [ReminderPlanner] turns them into
 * [ReminderPlan]s, [AlarmManagerPrayerScheduler] arms a real exact alarm, [PrayerReminderReceiver]
 * is manifest-registered and posts the notification -- but NOTHING in any production file ever
 * called [PrayerAlarmScheduler.scheduleReminder]. The chain was severed at exactly one link: the
 * scheduler was constructed in the composition root and then never asked to schedule anything, so
 * the receiver could never fire and `SCHEDULE_EXACT_ALARM` was a Play-restricted permission with
 * no caller at all. This class is that link.
 *
 * Driven from [org.pca.app.runtime.graph.PcaAppGraph.runUsageLocationIngestionCycle]'s existing
 * non-critical half, off the SAME live platform fix that cycle already reads for geofence
 * evaluation -- deliberately no second periodic scheduler and no second location read, matching
 * the reuse decision [org.pca.app.runtime.location.geofence.GeofenceMonitor] already made. Being
 * in the non-critical half means reminder (re-)scheduling backs off in Battery Saver exactly like
 * the prayer-location staleness notice next to it; already-armed alarms are unaffected, since
 * `AlarmManager` holds them independently of this process.
 *
 * ## Idempotence
 * Safe to call every cycle. Each prayer maps to exactly one `PendingIntent` request code in
 * [AlarmManagerPrayerScheduler], so re-arming with `FLAG_UPDATE_CURRENT` replaces that prayer's
 * alarm rather than accumulating alarms, and [ReminderPlanner.nextPlans] yields at most one plan
 * per prayer. The `SCHEDULED` bookkeeping row's id is derived from
 * `deviceId|prayer|remindAtEpochMillis`, so re-recording the same armed reminder is the upsert
 * [PrayerReminderEventRepository] documents, never a new row per cycle. A reminder whose time has
 * passed is never re-armed (an exact alarm in the past fires immediately) -- it simply drops out
 * of [ReminderPlanner.nextPlans] and the next day's occurrence takes its place.
 *
 * ## Reporting an unavailable capability honestly
 * A refused schedule is NOT swallowed. It is reported through the exact mechanism every other
 * lost-capability signal in this app already uses (see
 * [org.pca.app.runtime.tamper.CameraDegradationMonitor] /
 * [org.pca.app.runtime.tamper.VpnDegradationMonitor]): a [TamperEventRepository] row plus
 * [notifyParent], which the composition root binds to the same
 * [org.pca.app.platform.CapabilityTamperAlertNotificationDelivery] those monitors use.
 *
 * It is transition-debounced the same way those monitors are, so a 5-minute cycle does not
 * re-alert forever while the state is unchanged. It deliberately differs from them in ONE
 * respect, and only one: those monitors treat their first-ever observation as a baseline and stay
 * silent, because they are sampling ambient platform state that may simply never have been
 * granted. This class is not sampling -- it is reporting a concrete, already-attempted delivery of
 * a user-facing feature that just failed. A never-granted exact-alarm permission means prayer
 * reminders will never fire, which is precisely the fact that must not stay silent, so the first
 * refusal reports.
 *
 * ## Calculation policy
 * [calculationMethod]/[asrMethod]/[leadTime] are constructor parameters with documented defaults,
 * not hardcoded values. There is no family-authored prayer-settings source in this app yet; when
 * one exists it must be passed in here rather than this class growing its own opinion. Unlike a
 * catalogue or an eligible-app list, there is no honest "empty" default available -- a prayer time
 * cannot be computed without SOME convention -- so the defaults name the calculator's own
 * general-purpose method explicitly instead of pretending no choice was made.
 */
class PrayerReminderScheduleCoordinator(
    private val scheduler: PrayerAlarmScheduler,
    private val deviceIdProvider: () -> String?,
    private val wallClockTimeSource: WallClockTimeSource,
    private val prayerReminderEventRepository: PrayerReminderEventRepository,
    private val tamperEventRepository: TamperEventRepository,
    private val notifyParent: (String) -> Boolean,
    private val calculationMethod: CalculationMethod = DEFAULT_CALCULATION_METHOD,
    private val asrMethod: AsrMethod = DEFAULT_ASR_METHOD,
    private val leadTime: Duration = DEFAULT_LEAD_TIME,
) {
    /** Guards the read-then-write of [lastReportedUnavailability] plus the alarm arming it gates
     * -- same reason [org.pca.app.runtime.tamper.UsageAccessDegradationMonitor] holds one: the
     * in-process poll loop and the `WorkManager` safety-net job are genuinely concurrent callers
     * of the cycle this runs inside. */
    private val scheduleMutex = Mutex()

    @Volatile
    private var lastReportedUnavailability: String? = null

    /**
     * Computes today's and tomorrow's prayer schedules for [coordinates] in [zoneId], and arms the
     * next still-future reminder for each of the five prayers. Returns how many alarms were
     * actually armed -- 0 is a real, reportable answer (capability refused, or every one of
     * today's reminders has passed and tomorrow's could not be resolved), never silently
     * indistinguishable from success.
     */
    suspend fun scheduleUpcomingReminders(coordinates: Coordinates, zoneId: ZoneId): Int = scheduleMutex.withLock {
        val now = Instant.ofEpochMilli(wallClockTimeSource.currentTimeMillis()).atZone(zoneId)
        val today = PrayerTimeCalculator.calculate(now.toLocalDate(), coordinates, zoneId, calculationMethod, asrMethod)
        val tomorrow = PrayerTimeCalculator.calculate(now.toLocalDate().plusDays(1), coordinates, zoneId, calculationMethod, asrMethod)
        val plans = ReminderPlanner.nextPlans(today, tomorrow, leadTime, now)

        val deviceId = deviceIdProvider()
        var armed = 0
        for (plan in plans) {
            when (val outcome = scheduler.scheduleReminder(plan)) {
                ReminderScheduleOutcome.SCHEDULED -> {
                    armed++
                    if (deviceId != null) recordScheduled(deviceId, plan)
                }
                ReminderScheduleOutcome.EXACT_ALARMS_NOT_PERMITTED,
                ReminderScheduleOutcome.ALARM_SERVICE_UNAVAILABLE,
                -> {
                    // Every remaining plan would be refused for the identical reason -- stop
                    // rather than emit the same refusal five times over.
                    reportUnavailable(conditionFor(outcome), deviceId)
                    return@withLock armed
                }
            }
        }
        // The capability is demonstrably working again, so a LATER loss must alert afresh rather
        // than being debounced against a stale report.
        if (armed > 0) lastReportedUnavailability = null
        armed
    }

    private fun conditionFor(outcome: ReminderScheduleOutcome): String = when (outcome) {
        ReminderScheduleOutcome.EXACT_ALARMS_NOT_PERMITTED -> CONDITION_EXACT_ALARMS_NOT_PERMITTED
        ReminderScheduleOutcome.ALARM_SERVICE_UNAVAILABLE -> CONDITION_ALARM_SERVICE_UNAVAILABLE
        ReminderScheduleOutcome.SCHEDULED -> error("SCHEDULED is not an unavailability condition")
    }

    /**
     * Delivery metadata only (doc 10 Section 4.7): that a reminder was armed for this prayer at
     * this instant -- never a devotional-behaviour signal. Mirrors [PrayerReminderReceiver]'s own
     * "never fabricate an id" discipline: no enrolled device identity means no row, while the
     * alarm itself is still armed (a reminder does not depend on enrollment to be useful).
     */
    private suspend fun recordScheduled(deviceId: String, plan: ReminderPlan) {
        val remindAtEpochMillis = plan.remindAt.toInstant().toEpochMilli()
        prayerReminderEventRepository.record(
            id = UUID.nameUUIDFromBytes("$deviceId|${plan.prayer.name}|$remindAtEpochMillis".toByteArray(Charsets.UTF_8)).toString(),
            deviceId = deviceId,
            prayerKey = plan.prayer.name,
            scheduledAtEpochMillis = remindAtEpochMillis,
            deliveryState = PrayerDeliveryState.SCHEDULED,
        )
    }

    private suspend fun reportUnavailable(condition: String, deviceId: String?) {
        if (lastReportedUnavailability == condition) return
        lastReportedUnavailability = condition
        if (deviceId != null) {
            val detectedAt = wallClockTimeSource.currentTimeMillis()
            tamperEventRepository.record(
                id = UUID.nameUUIDFromBytes("$deviceId|$condition|$detectedAt".toByteArray(Charsets.UTF_8)).toString(),
                deviceId = deviceId,
                conditionType = condition,
                detectedAtEpochMillis = detectedAt,
            )
        }
        notifyParent(condition)
    }

    companion object {
        const val CONDITION_EXACT_ALARMS_NOT_PERMITTED = "PRAYER_EXACT_ALARMS_NOT_PERMITTED"
        const val CONDITION_ALARM_SERVICE_UNAVAILABLE = "PRAYER_ALARM_SERVICE_UNAVAILABLE"

        /** Ten minutes before the prayer -- the same lead time the reminder-planning contract is
         * exercised with, and short enough that a reminder is never mistaken for the call itself. */
        val DEFAULT_LEAD_TIME: Duration = Duration.ofMinutes(10)

        /** [PrayerTimeCalculator]'s general-purpose, globally applicable convention. Replaced by a
         * family-authored setting the moment one exists (see this class's own doc comment). */
        val DEFAULT_CALCULATION_METHOD: CalculationMethod = CalculationMethod.MUSLIM_WORLD_LEAGUE

        /** The majority (Shafi'i/Maliki/Hanbali) shadow-length convention. */
        val DEFAULT_ASR_METHOD: AsrMethod = AsrMethod.STANDARD
    }
}
