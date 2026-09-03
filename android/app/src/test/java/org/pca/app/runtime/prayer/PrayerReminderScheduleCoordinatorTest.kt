package org.pca.app.runtime.prayer

import java.time.Duration
import java.time.ZoneId
import java.time.ZonedDateTime
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.pca.app.feature.prayer.model.Coordinates
import org.pca.app.feature.prayer.model.PrayerName
import org.pca.app.feature.prayer.reminder.PrayerAlarmScheduler
import org.pca.app.feature.prayer.reminder.ReminderPlan
import org.pca.app.feature.prayer.reminder.ReminderScheduleOutcome
import org.pca.app.foundation.WallClockTimeSource
import org.pca.app.persistence.PcaLocalDatabase
import org.pca.app.persistence.PersistenceTestSupport
import org.pca.app.persistence.entity.PrayerDeliveryState
import org.pca.app.persistence.repository.PrayerReminderEventRepository
import org.pca.app.persistence.repository.TamperEventRepository
import org.robolectric.RobolectricTestRunner

private class FakeWallClock(var nowMillis: Long) : WallClockTimeSource {
    override fun currentTimeMillis(): Long = nowMillis
}

/**
 * Records what it was asked to schedule and answers with a test-controlled outcome -- the whole
 * point of PPR1R-D005 is that the production path actually reaches this call, so "was it called,
 * and with what" is the observable under test.
 */
private class RecordingScheduler(var outcome: ReminderScheduleOutcome = ReminderScheduleOutcome.SCHEDULED) : PrayerAlarmScheduler {
    val scheduled = mutableListOf<ReminderPlan>()
    val cancelled = mutableListOf<PrayerName>()

    override fun scheduleReminder(plan: ReminderPlan): ReminderScheduleOutcome {
        scheduled += plan
        return outcome
    }

    override fun cancelReminder(prayer: PrayerName) {
        cancelled += prayer
    }

    override fun cancelAll() = Unit
}

/**
 * PPR1R-D005: `AlarmManagerPrayerScheduler` was constructed in `PcaAppGraph` and then never asked
 * to schedule anything, so the manifest-registered `PrayerReminderReceiver` could never fire and
 * `SCHEDULE_EXACT_ALARM` was a Play-restricted permission with no caller. These tests pin the
 * coordinator that closes that gap: real reminders reach the scheduler, a refused exact-alarm
 * capability is reported rather than swallowed, and repeated cycles stay idempotent.
 *
 * Uses the real, in-memory-Room-backed repositories (the same [PersistenceTestSupport.inMemoryDb]
 * discipline `CapabilityDegradationMonitorTest` uses for the identical reason) -- the persistence
 * half of "was this surfaced" is a real row, not a mock's recorded call.
 */
@RunWith(RobolectricTestRunner::class)
class PrayerReminderScheduleCoordinatorTest {

    private lateinit var db: PcaLocalDatabase
    private lateinit var prayerReminderEventRepository: PrayerReminderEventRepository
    private lateinit var tamperEventRepository: TamperEventRepository

    /** Makkah, and an instant just after midnight local time so every one of the day's five
     * reminders is still in the future -- keeps the "how many were armed" assertions exact. */
    private val zone: ZoneId = ZoneId.of("Asia/Riyadh")
    private val coordinates = Coordinates(latitudeDegrees = 21.4225, longitudeDegrees = 39.8262)
    private val justAfterMidnight = ZonedDateTime.of(2026, 3, 15, 0, 5, 0, 0, zone).toInstant().toEpochMilli()

    @Before
    fun setUp() {
        db = PersistenceTestSupport.inMemoryDb()
        prayerReminderEventRepository = PrayerReminderEventRepository(db.prayerReminderEventDao())
        tamperEventRepository = TamperEventRepository(db.tamperEventDao())
    }

    @After
    fun tearDown() {
        db.close()
    }

    private fun coordinator(
        scheduler: PrayerAlarmScheduler,
        clock: WallClockTimeSource,
        deviceId: String? = DEVICE_ID,
        notified: MutableList<String> = mutableListOf(),
    ) = PrayerReminderScheduleCoordinator(
        scheduler = scheduler,
        deviceIdProvider = { deviceId },
        wallClockTimeSource = clock,
        prayerReminderEventRepository = prayerReminderEventRepository,
        tamperEventRepository = tamperEventRepository,
        notifyParent = { condition -> notified += condition; true },
    )

    @Test
    fun `a cycle arms one real reminder per prayer and records each as SCHEDULED`() = runTest {
        val scheduler = RecordingScheduler()
        val clock = FakeWallClock(justAfterMidnight)

        val armed = coordinator(scheduler, clock).scheduleUpcomingReminders(coordinates, zone)

        assertEquals("all five daily prayers must be armed", 5, armed)
        assertEquals(5, scheduler.scheduled.size)
        assertEquals(
            "sunrise is a calculation anchor, never a reminder",
            setOf(PrayerName.FAJR, PrayerName.DHUHR, PrayerName.ASR, PrayerName.MAGHRIB, PrayerName.ISHA),
            scheduler.scheduled.map { it.prayer }.toSet(),
        )
        scheduler.scheduled.forEach { plan ->
            assertTrue(
                "an exact alarm must never be armed for a moment already past -- it would fire immediately",
                plan.remindAt.toInstant().toEpochMilli() > clock.nowMillis,
            )
            assertEquals(plan.prayerAt.minus(Duration.ofMinutes(10)), plan.remindAt)
        }

        val rows = prayerReminderEventRepository.getForDevice(DEVICE_ID)
        assertEquals(5, rows.size)
        assertTrue(rows.all { it.deliveryState == PrayerDeliveryState.SCHEDULED })
        assertEquals(
            scheduler.scheduled.map { it.remindAt.toInstant().toEpochMilli() }.toSet(),
            rows.map { it.scheduledAtEpochMillis }.toSet(),
        )
    }

    @Test
    fun `re-running the same cycle is idempotent -- no duplicate bookkeeping rows`() = runTest {
        val scheduler = RecordingScheduler()
        val clock = FakeWallClock(justAfterMidnight)
        val coordinator = coordinator(scheduler, clock)

        coordinator.scheduleUpcomingReminders(coordinates, zone)
        coordinator.scheduleUpcomingReminders(coordinates, zone)

        assertEquals(
            "the poll loop runs every few minutes -- re-arming must upsert, never accumulate",
            5,
            prayerReminderEventRepository.getForDevice(DEVICE_ID).size,
        )
    }

    @Test
    fun `a refused exact-alarm capability is surfaced as a tamper event and an alert, never silently swallowed`() = runTest {
        val scheduler = RecordingScheduler(outcome = ReminderScheduleOutcome.EXACT_ALARMS_NOT_PERMITTED)
        val clock = FakeWallClock(justAfterMidnight)
        val notified = mutableListOf<String>()

        val armed = coordinator(scheduler, clock, notified = notified).scheduleUpcomingReminders(coordinates, zone)

        assertEquals("nothing can be armed without the exact-alarm capability", 0, armed)
        assertEquals(listOf(PrayerReminderScheduleCoordinator.CONDITION_EXACT_ALARMS_NOT_PERMITTED), notified)

        val tamperRows = tamperEventRepository.getForDevice(DEVICE_ID)
        assertEquals(1, tamperRows.size)
        assertEquals(PrayerReminderScheduleCoordinator.CONDITION_EXACT_ALARMS_NOT_PERMITTED, tamperRows.single().conditionType)
        assertTrue(
            "no reminder may be recorded as SCHEDULED when none was actually armed",
            prayerReminderEventRepository.getForDevice(DEVICE_ID).isEmpty(),
        )
        assertEquals("every remaining plan would be refused identically -- report once, not five times", 1, scheduler.scheduled.size)
    }

    @Test
    fun `a missing alarm service is reported under its own condition`() = runTest {
        val scheduler = RecordingScheduler(outcome = ReminderScheduleOutcome.ALARM_SERVICE_UNAVAILABLE)
        val notified = mutableListOf<String>()

        coordinator(scheduler, FakeWallClock(justAfterMidnight), notified = notified).scheduleUpcomingReminders(coordinates, zone)

        assertEquals(listOf(PrayerReminderScheduleCoordinator.CONDITION_ALARM_SERVICE_UNAVAILABLE), notified)
    }

    @Test
    fun `an unchanged refusal is debounced, and a refusal after a recovery alerts again`() = runTest {
        val scheduler = RecordingScheduler(outcome = ReminderScheduleOutcome.EXACT_ALARMS_NOT_PERMITTED)
        val clock = FakeWallClock(justAfterMidnight)
        val notified = mutableListOf<String>()
        val coordinator = coordinator(scheduler, clock, notified = notified)

        coordinator.scheduleUpcomingReminders(coordinates, zone)
        clock.nowMillis += 5 * 60_000L
        coordinator.scheduleUpcomingReminders(coordinates, zone)
        assertEquals("a 5-minute poll must not re-alert while the state is unchanged", 1, notified.size)

        // The user grants the permission in Settings: reminders arm again.
        scheduler.outcome = ReminderScheduleOutcome.SCHEDULED
        clock.nowMillis += 5 * 60_000L
        assertEquals(5, coordinator.scheduleUpcomingReminders(coordinates, zone))
        assertEquals(1, notified.size)

        // ...and it is revoked again: a genuinely NEW loss must alert, not stay debounced against
        // the stale earlier report.
        scheduler.outcome = ReminderScheduleOutcome.EXACT_ALARMS_NOT_PERMITTED
        clock.nowMillis += 5 * 60_000L
        coordinator.scheduleUpcomingReminders(coordinates, zone)
        assertEquals(2, notified.size)
        assertEquals(PrayerReminderScheduleCoordinator.CONDITION_EXACT_ALARMS_NOT_PERMITTED, notified.last())
    }

    @Test
    fun `an unenrolled device still gets its reminders armed, but fabricates no device-scoped rows`() = runTest {
        val scheduler = RecordingScheduler()
        val notified = mutableListOf<String>()

        val armed = coordinator(scheduler, FakeWallClock(justAfterMidnight), deviceId = null, notified = notified)
            .scheduleUpcomingReminders(coordinates, zone)

        assertEquals(5, armed)
        assertTrue(prayerReminderEventRepository.getForDevice(DEVICE_ID).isEmpty())
    }

    @Test
    fun `late in the day the already-passed reminders roll forward to tomorrow rather than firing immediately`() = runTest {
        val scheduler = RecordingScheduler()
        // 23:30 local: every one of this day's five reminders is already behind us.
        val clock = FakeWallClock(ZonedDateTime.of(2026, 3, 15, 23, 30, 0, 0, zone).toInstant().toEpochMilli())

        val armed = coordinator(scheduler, clock).scheduleUpcomingReminders(coordinates, zone)

        assertEquals(5, armed)
        scheduler.scheduled.forEach { plan ->
            assertTrue(
                "a rolled-forward reminder must be in the future, not a past instant an exact alarm would fire at once",
                plan.remindAt.toInstant().toEpochMilli() > clock.nowMillis,
            )
            assertEquals("2026-03-16", plan.remindAt.toLocalDate().toString())
        }
    }

    private companion object {
        const val DEVICE_ID = "device-prayer-1"
    }
}
