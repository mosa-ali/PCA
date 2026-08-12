package org.pca.app.runtime.prayer

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import org.pca.app.feature.prayer.model.PrayerName
import org.pca.app.feature.prayer.reminder.PrayerAlarmScheduler
import org.pca.app.feature.prayer.reminder.ReminderPlan

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
     * 16: no crash-prone hidden behavior). A denied/unavailable exact-alarm capability is a silent
     * no-op here; surfacing that state to the user is a separate feature slice's responsibility
     * (the reminder UI this class explicitly does not own, see class doc).
     */
    override fun scheduleReminder(plan: ReminderPlan) {
        val manager = alarmManager ?: return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !manager.canScheduleExactAlarms()) return
        val pendingIntent = pendingIntentFor(plan.prayer)
        val triggerAtMillis = plan.remindAt.toInstant().toEpochMilli()
        try {
            manager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAtMillis, pendingIntent)
        } catch (_: SecurityException) {
            // Permission revoked between the check above and this call -- fail safe, no crash.
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
