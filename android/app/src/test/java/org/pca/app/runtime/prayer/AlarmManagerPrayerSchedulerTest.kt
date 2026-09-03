package org.pca.app.runtime.prayer

import android.app.AlarmManager
import android.content.Context
import androidx.test.core.app.ApplicationProvider
import java.time.ZoneId
import java.time.ZonedDateTime
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.pca.app.feature.prayer.model.PrayerName
import org.pca.app.feature.prayer.reminder.ReminderPlan
import org.pca.app.feature.prayer.reminder.ReminderScheduleOutcome
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.shadows.ShadowAlarmManager

/**
 * PPR1R-D005: `scheduleReminder` used to return `Unit`, so "a real exact alarm is armed" and "the
 * OS refused and nothing will ever fire" were literally the same observable outcome -- nobody
 * could surface the refusal because nobody could see it. These tests pin the reported outcome in
 * both directions, and (in the permitted case) that a real alarm actually lands in `AlarmManager`.
 *
 * Robolectric runs at SDK 34 for this module (`src/test/resources/robolectric.properties`), i.e.
 * above the API 31 threshold where `canScheduleExactAlarms()` is consulted at all.
 */
@RunWith(RobolectricTestRunner::class)
class AlarmManagerPrayerSchedulerTest {

    private val plan = ReminderPlan(
        prayer = PrayerName.MAGHRIB,
        prayerAt = ZonedDateTime.of(2026, 3, 15, 18, 20, 0, 0, ZoneId.of("Asia/Riyadh")),
        remindAt = ZonedDateTime.of(2026, 3, 15, 18, 10, 0, 0, ZoneId.of("Asia/Riyadh")),
    )

    private fun scheduler(context: Context) =
        AlarmManagerPrayerScheduler(context) { prayer -> PrayerReminderIntents.build(context, prayer) }

    @Test
    fun `an exact alarm is armed and reported as SCHEDULED when the capability is granted`() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val alarmManager = context.getSystemService(AlarmManager::class.java)
        ShadowAlarmManager.setCanScheduleExactAlarms(true)

        val outcome = scheduler(context).scheduleReminder(plan)

        assertEquals(ReminderScheduleOutcome.SCHEDULED, outcome)
        val scheduled = shadowOf(alarmManager).scheduledAlarms
        assertEquals(1, scheduled.size)
        assertEquals(
            "the alarm must be anchored to wall-clock time -- prayer times are wall-clock by nature",
            AlarmManager.RTC_WAKEUP,
            scheduled.single().getType(),
        )
        assertEquals(plan.remindAt.toInstant().toEpochMilli(), scheduled.single().getTriggerAtMs())
    }

    @Test
    fun `a denied exact-alarm capability is reported as EXACT_ALARMS_NOT_PERMITTED, and nothing is armed`() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val alarmManager = context.getSystemService(AlarmManager::class.java)
        ShadowAlarmManager.setCanScheduleExactAlarms(false)

        val outcome = scheduler(context).scheduleReminder(plan)

        assertEquals(ReminderScheduleOutcome.EXACT_ALARMS_NOT_PERMITTED, outcome)
        assertTrue(
            "a refused capability must arm nothing at all -- a half-armed inexact alarm would be worse than none",
            shadowOf(alarmManager).scheduledAlarms.isEmpty(),
        )
    }

    @Test
    fun `re-arming the same prayer replaces its alarm rather than accumulating alarms`() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val alarmManager = context.getSystemService(AlarmManager::class.java)
        ShadowAlarmManager.setCanScheduleExactAlarms(true)
        val scheduler = scheduler(context)

        scheduler.scheduleReminder(plan)
        scheduler.scheduleReminder(plan.copy(remindAt = plan.remindAt.plusMinutes(1)))

        assertEquals(
            "the poll loop re-arms every cycle -- one PendingIntent request code per prayer must keep that at one alarm",
            1,
            shadowOf(alarmManager).scheduledAlarms.size,
        )
    }
}
