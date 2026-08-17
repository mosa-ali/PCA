package org.pca.app.runtime.schedule

import java.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class NightProtectionScheduleTest {
    private val window = SchedulePolicyDefaults.defaultNightProtection("UTC")

    @Test
    fun `default window crosses midnight and applies every day`() {
        assertEquals(TimeOfDay(21, 30), window.start)
        assertEquals(TimeOfDay(7, 0), window.end)
        assertEquals((0..6).toList(), window.daysOfWeek)
        assertEquals(ScheduleWindowKind.BEDTIME, window.kind)
        assertTrue(isWindowActive(window, Instant.parse("2026-01-07T21:30:00Z")))
        assertTrue(isWindowActive(window, Instant.parse("2026-01-08T06:59:59Z")))
    }

    @Test
    fun `default window ends exactly at seven`() {
        assertTrue(!isWindowActive(window, Instant.parse("2026-01-08T07:00:00Z")))
    }

    @Test
    fun `policy evaluation supplies the baseline when persisted policy omitted bedtime`() {
        val policy = SchedulePolicyV1(
            policyId = "policy-without-bedtime",
            policyRevision = 1,
            familyId = "family-1",
            childProfileId = "child-1",
            timezone = "UTC",
            windows = emptyList(),
            bonusGrants = emptyList(),
            parentExceptions = emptyList(),
            dailyLimits = emptyList(),
            trustSetEpoch = 1,
            keyEpoch = 1,
            issuedAt = Instant.parse("2026-01-01T00:00:00Z"),
            effectiveFrom = Instant.parse("2026-01-01T00:00:00Z"),
        )

        val input = policy.toEvaluationInput(
            nowUtc = Instant.parse("2026-01-07T22:00:00Z"),
            appToken = "ordinary-child-app",
            enforcementCapability = EnforcementCapabilityState.ENFORCED,
            connectivity = Connectivity.OFFLINE,
            lastPolicySyncAtUtc = Instant.parse("2026-01-01T00:00:00Z"),
        )

        assertEquals(1, input.windows.count { it.id == SchedulePolicyDefaults.DEFAULT_NIGHT_PROTECTION_ID })
        assertEquals(ScheduleDecisionKind.BLOCKED_BEDTIME, ScheduleEvaluator.evaluate(input).decision)
    }
}
