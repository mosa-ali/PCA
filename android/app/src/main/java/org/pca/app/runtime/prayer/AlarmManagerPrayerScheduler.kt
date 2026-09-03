package org.pca.app.runtime.prayer

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import org.pca.app.feature.prayer.model.PrayerName
import org.pca.app.feature.prayer.reminder.PrayerAlarmScheduler
import org.pca.app.feature.prayer.reminder.ReminderPlan
import org.pca.app.feature.prayer.reminder.ReminderScheduleOutcome

/**
 * Real, production [PrayerAlarmScheduler] binding -- doc `reminder/PrayerReminderContract.kt`
 * explicitly documents this as a Coordinator integration task ("the coordinator binds a
 * [PrayerAlarmScheduler] adapter that turns a [ReminderPlan] into an actual OS alarm"). Uses
 * documented `AlarmManager.setExactAndAllowWhileIdle` (Section 17: documented mechanisms only, no
 * `AccessibilityService`/undocumented persistence) with `RTC_WAKEUP` so a reminder can still fire
 * while the device is dozing, since prayer times are wall-clock-anchored by nature.
 *
 * Deliberately does not itself decide the reminder's *content* (Section 16: no hidden behavior) --
 * [receiverIntentFactory] is supplied by the composition root so the concrete broadcast
 * receiver/notification-posting responsibility stays with whichever feature slice owns the actual
 * user-visible reminder UI; this class only owns the OS alarm plumbing.
 */
class AlarmManagerPrayerScheduler(
    private val context: Context,
    private val receiverIntentFactory: (PrayerName) -> Intent,
) : PrayerAlarmScheduler {
    private val alarmManager = context.applicationContext.getSystemService(Context.ALARM_SERVICE) as? AlarmManager

    /**
     * Checks [AlarmManager.canScheduleExactAlarms] first (API 31+ special-access requirement, see
     * the `SCHEDULE_EXACT_ALARM` manifest entry) and additionally guards the call itself against
     * [SecurityException] -- the permission can be revoked by the user between the check and the
     * call, and this must degrade to "reminder not scheduled" rather than crash the app (Section
     * 16: no crash-prone hidden behavior).
     *
     * PPR1R-D005: it still never crashes, but it is no longer SILENT. This used to return `Unit`,
     * so "armed a real alarm" and "the OS refused, nothing will ever fire" were the same
     * observable outcome and the refusal could not be surfaced by anyone. It now reports a
     * [ReminderScheduleOutcome], and
     * [org.pca.app.runtime.prayer.PrayerReminderScheduleCoordinator] -- the production caller --
     * turns a refusal into a real tamper-event row plus the same capability alert every other
     * lost-capability signal in this app uses. This class still does not own reminder UI (see
     * class doc); it only stops hiding the failure from the layer that does.
     */
    override fun scheduleReminder(plan: ReminderPlan): ReminderScheduleOutcome {
        val manager = alarmManager ?: return ReminderScheduleOutcome.ALARM_SERVICE_UNAVAILABLE
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !manager.canScheduleExactAlarms()) {
            return ReminderScheduleOutcome.EXACT_ALARMS_NOT_PERMITTED
        }
        val pendingIntent = pendingIntentFor(plan.prayer)
        val triggerAtMillis = plan.remindAt.toInstant().toEpochMilli()
        return try {
            manager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAtMillis, pendingIntent)
            ReminderScheduleOutcome.SCHEDULED
        } catch (_: SecurityException) {
            // Permission revoked between the check above and this call -- fail safe, no crash,
            // and reported as the same recoverable not-permitted state the check itself reports.
            ReminderScheduleOutcome.EXACT_ALARMS_NOT_PERMITTED
        }
    }

    override fun cancelReminder(prayer: PrayerName) {
        val manager = alarmManager ?: return
        manager.cancel(pendingIntentFor(prayer))
    }

    override fun cancelAll() {
        PrayerName.entries.forEach { cancelReminder(it) }
    }

    private fun pendingIntentFor(prayer: PrayerName): PendingIntent {
        val intent = receiverIntentFactory(prayer)
        return PendingIntent.getBroadcast(
            context,
            REQUEST_CODE_BASE + prayer.ordinal,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    private companion object {
        const val REQUEST_CODE_BASE = 4_200
    }
}
