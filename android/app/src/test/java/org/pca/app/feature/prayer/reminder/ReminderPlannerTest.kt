package org.pca.app.feature.prayer.reminder

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test
import org.pca.app.feature.prayer.calc.PrayerTimeCalculator
import org.pca.app.feature.prayer.model.AsrMethod
import org.pca.app.feature.prayer.model.CalculationMethod
import org.pca.app.feature.prayer.model.Coordinates
import org.pca.app.feature.prayer.model.PrayerName
import java.time.Duration
import java.time.LocalDate
import java.time.ZoneId

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
}
