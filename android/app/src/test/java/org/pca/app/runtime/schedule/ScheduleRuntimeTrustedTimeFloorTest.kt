package org.pca.app.runtime.schedule

import java.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ScheduleRuntimeTrustedTimeFloorTest {
    private val now = Instant.parse("2026-01-07T20:00:00Z") // 23:00 Asia/Riyadh
    private val bedtime = SchedulePolicyV1(
        policyId = "policy-1",
        policyRevision = 1,
        familyId = "family-1",
        childProfileId = "child-1",
        timezone = "Asia/Riyadh",
        windows = listOf(
            ScheduleWindow(
                id = "bedtime",
                kind = ScheduleWindowKind.BEDTIME,
                daysOfWeek = listOf(0, 1, 2, 3, 4, 5, 6),
                start = TimeOfDay(22, 0),
                end = TimeOfDay(6, 0),
                appScope = AppScope.All,
                timezone = "Asia/Riyadh",
            ),
        ),
        bonusGrants = emptyList(),
        parentExceptions = emptyList(),
        dailyLimits = emptyList(),
        trustSetEpoch = 1,
        keyEpoch = 1,
        issuedAt = Instant.parse("2026-01-01T00:00:00Z"),
        effectiveFrom = Instant.parse("2026-01-01T00:00:00Z"),
    )

    private fun runtime(
        policy: SchedulePolicyV1 = bedtime,
        floor: Instant? = null,
        floorProvider: () -> Instant? = { floor },
    ): ScheduleRuntime {
        val store = InMemorySchedulePolicyStore()
        store.save(
            SchedulePolicySnapshot(
                candidatePolicy = policy,
                lastKnownGoodPolicy = policy,
                lastPolicySyncAtUtc = now,
                deviceTrustSetEpoch = 1,
                deviceKeyEpoch = 1,
            ),
        )
        return ScheduleRuntime(store, trustedTimeFloorProvider = floorProvider)
    }

    @Test
    fun `rollback floor keeps bedtime window and context aligned`() {
        val rolledBackWallTime = Instant.parse("2026-01-07T09:00:00Z") // 12:00 Asia/Riyadh
        val runtime = runtime(floor = now)

        val result = runtime.evaluate(
            rolledBackWallTime,
            "app-a",
            EnforcementCapabilityState.ENFORCED,
            Connectivity.ONLINE,
        )

        assertEquals(ScheduleDecisionKind.BLOCKED_BEDTIME, result.decision.decision)
        assertTrue(runtime.isPcaBedtimeActive(rolledBackWallTime))
        assertTrue(runtime.isScheduledQuietContext(rolledBackWallTime))
    }

    @Test
    fun `rollback floor prevents expired policy from being revived`() {
        val expiresAt = Instant.parse("2026-01-07T12:00:00Z")
        val expired = bedtime.copy(expiresAt = expiresAt)
        val runtime = runtime(policy = expired, floor = Instant.parse("2026-01-07T13:00:00Z"))

        val result = runtime.evaluate(
            Instant.parse("2026-01-07T11:00:00Z"),
            "app-a",
            EnforcementCapabilityState.ENFORCED,
            Connectivity.ONLINE,
        )

        assertEquals(ScheduleRuntimeState.INVALID, result.runtimeState)
        assertNull(result.effectivePolicy)
    }

    @Test
    fun `trusted floor applies scheduled policy after effectiveFrom during rollback`() {
        val scheduled = bedtime.copy(effectiveFrom = Instant.parse("2026-01-07T12:00:00Z"))
        val rolledBackWallTime = Instant.parse("2026-01-07T11:00:00Z")
        val runtime = runtime(policy = scheduled, floor = Instant.parse("2026-01-07T13:00:00Z"))

        val result = runtime.evaluate(
            rolledBackWallTime,
            "app-a",
            EnforcementCapabilityState.ENFORCED,
            Connectivity.ONLINE,
        )

        assertEquals(ScheduleRuntimeState.CURRENT, result.runtimeState)
        assertEquals(scheduled, result.effectivePolicy)
    }

    @Test
    fun `normal forward wall time remains authoritative above the stored floor`() {
        val normalTime = Instant.parse("2026-01-07T12:00:00Z") // 15:00 Asia/Riyadh
        val floor = Instant.parse("2026-01-07T11:00:00Z")
        val runtime = runtime(floor = floor)

        val result = runtime.evaluate(
            normalTime,
            "app-a",
            EnforcementCapabilityState.ENFORCED,
            Connectivity.ONLINE,
        )

        assertEquals(ScheduleDecisionKind.ALLOWED, result.decision.decision)
        assertFalse(runtime.isPcaBedtimeActive(normalTime))
    }

    @Test
    fun `trusted time floor read failure disables policy use and context claims`() {
        val runtime = runtime(floorProvider = { error("floor_unreadable") })

        val result = runtime.evaluate(
            now,
            "app-a",
            EnforcementCapabilityState.ENFORCED,
            Connectivity.ONLINE,
        )

        assertEquals(ScheduleRuntimeState.INVALID, result.runtimeState)
        assertEquals(ScheduleDecisionKind.ENFORCEMENT_UNAVAILABLE, result.decision.decision)
        assertNull(result.effectivePolicy)
        assertTrue(runtime.isPcaBedtimeActive(now))
        assertTrue(runtime.isScheduledQuietContext(now))
    }
}
