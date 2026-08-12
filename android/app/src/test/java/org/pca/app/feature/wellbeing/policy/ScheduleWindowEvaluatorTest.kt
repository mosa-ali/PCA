package org.pca.app.feature.wellbeing.policy

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.pca.app.feature.wellbeing.policy.ScheduleWindowEvaluator.WallClockSnapshot

class ScheduleWindowEvaluatorTest {

    private val noRestriction = SdkScheduleWindow()

    @Test
    fun `no restriction is always active`() {
        assertTrue(ScheduleWindowEvaluator.isActiveNow(noRestriction, WallClockSnapshot("2026-08-12", "WED", 720)))
    }

    @Test
    fun `date range excludes before start and after end`() {
        val schedule = SdkScheduleWindow(startDate = "2026-08-10", endDate = "2026-08-15")
        assertFalse(ScheduleWindowEvaluator.isActiveNow(schedule, WallClockSnapshot("2026-08-09", "SUN", 0)))
        assertTrue(ScheduleWindowEvaluator.isActiveNow(schedule, WallClockSnapshot("2026-08-12", "WED", 0)))
        assertFalse(ScheduleWindowEvaluator.isActiveNow(schedule, WallClockSnapshot("2026-08-16", "SUN", 0)))
    }

    @Test
    fun `empty daysOfWeek means every day`() {
        val schedule = SdkScheduleWindow(daysOfWeek = emptySet())
        assertTrue(ScheduleWindowEvaluator.isActiveNow(schedule, WallClockSnapshot("2026-08-12", "MON", 0)))
    }

    @Test
    fun `non-empty daysOfWeek restricts to listed days`() {
        val schedule = SdkScheduleWindow(daysOfWeek = setOf("SAT", "SUN"))
        assertTrue(ScheduleWindowEvaluator.isActiveNow(schedule, WallClockSnapshot("2026-08-15", "SAT", 0)))
        assertFalse(ScheduleWindowEvaluator.isActiveNow(schedule, WallClockSnapshot("2026-08-12", "WED", 0)))
    }

    @Test
    fun `ordinary time window`() {
        val schedule = SdkScheduleWindow(timeWindows = listOf(SdkTimeWindow(startMinute = 480, endMinute = 600)))
        assertTrue(ScheduleWindowEvaluator.isActiveNow(schedule, WallClockSnapshot("2026-08-12", "WED", 500)))
        assertFalse(ScheduleWindowEvaluator.isActiveNow(schedule, WallClockSnapshot("2026-08-12", "WED", 700)))
    }

    @Test
    fun `midnight-crossing time window`() {
        val schedule = SdkScheduleWindow(timeWindows = listOf(SdkTimeWindow(startMinute = 1320, endMinute = 60)))
        assertTrue(ScheduleWindowEvaluator.isActiveNow(schedule, WallClockSnapshot("2026-08-12", "WED", 1350)))
        assertTrue(ScheduleWindowEvaluator.isActiveNow(schedule, WallClockSnapshot("2026-08-12", "WED", 30)))
        assertFalse(ScheduleWindowEvaluator.isActiveNow(schedule, WallClockSnapshot("2026-08-12", "WED", 700)))
    }
}
