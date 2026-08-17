package org.pca.app.runtime.schedule

import java.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
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
        assertTrue(!isWindowActive(window, Instant.parse("2026-01-07T21:29:59Z")))
        assertTrue(isWindowActive(window, Instant.parse("2026-01-07T21:30:00Z")))
        assertTrue(isWindowActive(window, Instant.parse("2026-01-07T23:59:00Z")))
        assertTrue(isWindowActive(window, Instant.parse("2026-01-08T00:00:00Z")))
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

    private fun policyWithBedtimes(vararg windows: ScheduleWindow): SchedulePolicyV1 = SchedulePolicyV1(
        policyId = "bedtime-policy",
        policyRevision = 1,
        familyId = "family-1",
        childProfileId = "child-1",
        timezone = "UTC",
        windows = windows.toList(),
        bonusGrants = emptyList(),
        parentExceptions = emptyList(),
        dailyLimits = emptyList(),
        trustSetEpoch = 1,
        keyEpoch = 1,
        issuedAt = Instant.parse("2026-01-01T00:00:00Z"),
        effectiveFrom = Instant.parse("2026-01-01T00:00:00Z"),
    )

    private fun bedtime(id: String, start: TimeOfDay, end: TimeOfDay): ScheduleWindow = ScheduleWindow(
        id = id,
        kind = ScheduleWindowKind.BEDTIME,
        daysOfWeek = (0..6).toList(),
        start = start,
        end = end,
        appScope = AppScope.All,
        timezone = "UTC",
    )

    @Test
    fun `weaker explicit bedtime cannot replace the owner baseline`() {
        val policy = policyWithBedtimes(bedtime("weak", TimeOfDay(23, 0), TimeOfDay(6, 0)))
        val input = policy.toEvaluationInput(
            nowUtc = Instant.parse("2026-01-07T22:00:00Z"),
            appToken = "ordinary-child-app",
            enforcementCapability = EnforcementCapabilityState.ENFORCED,
            connectivity = Connectivity.OFFLINE,
            lastPolicySyncAtUtc = Instant.parse("2026-01-01T00:00:00Z"),
        )
        assertEquals(ScheduleDecisionKind.BLOCKED_BEDTIME, ScheduleEvaluator.evaluate(input).decision)
        assertTrue(policy.effectiveWindows().any { it.id == SchedulePolicyDefaults.DEFAULT_NIGHT_PROTECTION_ID })
    }

    @Test
    fun `stronger explicit bedtime extends coverage without creating a baseline gap`() {
        val policy = policyWithBedtimes(bedtime("strong", TimeOfDay(20, 0), TimeOfDay(8, 0)))
        val beforeBaseline = policy.toEvaluationInput(
            nowUtc = Instant.parse("2026-01-07T20:30:00Z"),
            appToken = "ordinary-child-app",
            enforcementCapability = EnforcementCapabilityState.ENFORCED,
            connectivity = Connectivity.OFFLINE,
            lastPolicySyncAtUtc = null,
        )
        val afterBaseline = policy.toEvaluationInput(
            nowUtc = Instant.parse("2026-01-08T07:30:00Z"),
            appToken = "ordinary-child-app",
            enforcementCapability = EnforcementCapabilityState.ENFORCED,
            connectivity = Connectivity.OFFLINE,
            lastPolicySyncAtUtc = null,
        )
        assertEquals(ScheduleDecisionKind.BLOCKED_BEDTIME, ScheduleEvaluator.evaluate(beforeBaseline).decision)
        assertEquals(ScheduleDecisionKind.BLOCKED_BEDTIME, ScheduleEvaluator.evaluate(afterBaseline).decision)
    }

    @Test
    fun `split parent bedtimes cannot introduce a gap inside the baseline`() {
        val policy = policyWithBedtimes(
            bedtime("early", TimeOfDay(20, 0), TimeOfDay(22, 0)),
            bedtime("late", TimeOfDay(23, 0), TimeOfDay(1, 0)),
        )
        val input = policy.toEvaluationInput(
            nowUtc = Instant.parse("2026-01-08T06:59:59Z"),
            appToken = "ordinary-child-app",
            enforcementCapability = EnforcementCapabilityState.ENFORCED,
            connectivity = Connectivity.OFFLINE,
            lastPolicySyncAtUtc = null,
        )
        assertEquals(ScheduleDecisionKind.BLOCKED_BEDTIME, ScheduleEvaluator.evaluate(input).decision)
        assertFalse(policy.effectiveWindows().none { it.id == SchedulePolicyDefaults.DEFAULT_NIGHT_PROTECTION_ID })
    }

    @Test
    fun `weak bedtime remains blocked through offline runtime reload`() {
        val policy = policyWithBedtimes(bedtime("weak", TimeOfDay(23, 0), TimeOfDay(6, 0)))
        val store = InMemorySchedulePolicyStore()
        store.save(
            SchedulePolicySnapshot(
                candidatePolicy = policy,
                lastKnownGoodPolicy = policy,
                lastPolicySyncAtUtc = Instant.parse("2026-01-01T00:00:00Z"),
                deviceTrustSetEpoch = 1,
                deviceKeyEpoch = 1,
            ),
        )

        val firstRuntime = ScheduleRuntime(store)
        val first = firstRuntime.evaluate(
            nowUtc = Instant.parse("2026-01-07T22:00:00Z"),
            appToken = "ordinary-child-app",
            enforcementCapability = EnforcementCapabilityState.ENFORCED,
            connectivity = Connectivity.OFFLINE,
        )
        val reloaded = ScheduleRuntime(store).evaluate(
            nowUtc = Instant.parse("2026-01-07T22:00:00Z"),
            appToken = "ordinary-child-app",
            enforcementCapability = EnforcementCapabilityState.ENFORCED,
            connectivity = Connectivity.OFFLINE,
        )

        assertEquals(ScheduleDecisionKind.BLOCKED_BEDTIME, first.decision.decision)
        assertEquals(first.decision, reloaded.decision)
    }
}
