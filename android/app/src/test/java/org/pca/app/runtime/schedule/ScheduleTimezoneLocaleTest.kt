package org.pca.app.runtime.schedule

import java.time.Instant
import java.util.Locale
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ScheduleTimezoneLocaleTest {
    @Test
    fun `local date stays canonical ASCII when the process locale uses Arabic digits`() {
        val originalLocale = Locale.getDefault()
        try {
            Locale.setDefault(Locale.forLanguageTag("ar"))

            val wallClock = toZonedWallClock(
                instant = Instant.parse("2026-10-14T12:00:00Z"),
                timeZone = "UTC",
            )

            assertEquals("2026-10-14", wallClock.localDate)
            assertTrue(wallClock.localDate.all { it in '0'..'9' || it == '-' })

            val decision = ScheduleEvaluator.evaluate(
                ScheduleEvaluationInput(
                    nowUtc = Instant.parse("2026-10-14T12:00:00Z"),
                    timezone = "UTC",
                    appToken = "app.example",
                    windows = emptyList(),
                    bonusGrants = emptyList(),
                    exceptions = emptyList(),
                    dailyLimit = DailyAppLimit(
                        appScope = AppScope.All,
                        limitMinutes = 30,
                        usedMinutesToday = 30,
                        anchorLocalDate = "2026-10-14",
                    ),
                    enforcementCapability = EnforcementCapabilityState.ENFORCED,
                    connectivity = Connectivity.OFFLINE,
                ),
            )
            assertEquals(ScheduleDecisionKind.BLOCKED_LIMIT_REACHED, decision.decision)
        } finally {
            Locale.setDefault(originalLocale)
        }
    }
}
