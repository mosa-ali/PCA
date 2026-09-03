package org.pca.app.feature.prayer.reminder

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.pca.app.feature.prayer.calc.PrayerTimeCalculator
import org.pca.app.feature.prayer.model.AsrMethod
import org.pca.app.feature.prayer.model.CalculationMethod
import org.pca.app.feature.prayer.model.Coordinates
import org.pca.app.feature.prayer.model.PrayerName
import java.time.Duration
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZonedDateTime

class ReminderPlannerTest {

    @Test
    fun `reminder plan covers only the five prayers, each lead-time minutes before`() {
        val schedule = PrayerTimeCalculator.calculate(
            LocalDate.of(2026, 3, 15),
            Coordinates(latitudeDegrees = 21.4225, longitudeDegrees = 39.8262),
            ZoneId.of("Asia/Riyadh"),
            CalculationMethod.UMM_AL_QURA,
            AsrMethod.STANDARD,
        )

        val plan = ReminderPlanner.buildPlan(schedule, leadTime = Duration.ofMinutes(10))

        assertEquals(5, plan.size)
        assertFalse(plan.any { it.prayer == PrayerName.SUNRISE })
        plan.forEach { assertEquals(it.prayerAt.minusMinutes(10), it.remindAt) }
    }

    // --- PPR1R-D005: nextPlans, the selection the OS-alarm adapter can actually honour ---

    private val zone: ZoneId = ZoneId.of("Asia/Riyadh")
    private val makkah = Coordinates(latitudeDegrees = 21.4225, longitudeDegrees = 39.8262)
    private val leadTime: Duration = Duration.ofMinutes(10)

    private fun scheduleFor(date: LocalDate) =
        PrayerTimeCalculator.calculate(date, makkah, zone, CalculationMethod.UMM_AL_QURA, AsrMethod.STANDARD)

    @Test
    fun `just after midnight every reminder still comes from today, and none is in the past`() {
        val today = LocalDate.of(2026, 3, 15)
        val now = ZonedDateTime.of(2026, 3, 15, 0, 5, 0, 0, zone)

        val plans = ReminderPlanner.nextPlans(scheduleFor(today), scheduleFor(today.plusDays(1)), leadTime, now)

        assertEquals(5, plans.size)
        assertEquals("at most one alarm exists per prayer", 5, plans.map { it.prayer }.toSet().size)
        plans.forEach {
            assertTrue("a reminder must never be planned into the past", it.remindAt.isAfter(now))
            assertEquals(today, it.remindAt.toLocalDate())
        }
    }

    @Test
    fun `late in the day the passed prayers roll forward to tomorrow instead of being dropped or re-fired`() {
        val today = LocalDate.of(2026, 3, 15)
        val now = ZonedDateTime.of(2026, 3, 15, 23, 30, 0, 0, zone)

        val plans = ReminderPlanner.nextPlans(scheduleFor(today), scheduleFor(today.plusDays(1)), leadTime, now)

        assertEquals(5, plans.size)
        plans.forEach {
            assertTrue(it.remindAt.isAfter(now))
            assertEquals(today.plusDays(1), it.remindAt.toLocalDate())
        }
    }

    @Test
    fun `mid-afternoon the day splits -- passed prayers roll forward, upcoming ones stay on today`() {
        val today = LocalDate.of(2026, 3, 15)
        // After Dhuhr, before Asr in Makkah on this date.
        val now = ZonedDateTime.of(2026, 3, 15, 13, 0, 0, 0, zone)

        val plans = ReminderPlanner.nextPlans(scheduleFor(today), scheduleFor(today.plusDays(1)), leadTime, now)
            .associateBy { it.prayer }

        assertEquals(5, plans.size)
        assertEquals(today.plusDays(1), plans.getValue(PrayerName.FAJR).remindAt.toLocalDate())
        assertEquals(today.plusDays(1), plans.getValue(PrayerName.DHUHR).remindAt.toLocalDate())
        assertEquals(today, plans.getValue(PrayerName.ASR).remindAt.toLocalDate())
        assertEquals(today, plans.getValue(PrayerName.MAGHRIB).remindAt.toLocalDate())
        assertEquals(today, plans.getValue(PrayerName.ISHA).remindAt.toLocalDate())
        plans.values.forEach { assertTrue(it.remindAt.isAfter(now)) }
    }
}
