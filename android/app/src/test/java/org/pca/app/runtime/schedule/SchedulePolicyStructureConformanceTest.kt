package org.pca.app.runtime.schedule

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

class SchedulePolicyStructureConformanceTest {
    private val now = Instant.parse("2026-10-09T12:00:00Z")

    private fun window(id: String, days: List<Int> = listOf(1), scope: AppScope = AppScope.All) = ScheduleWindow(
        id = id,
        kind = ScheduleWindowKind.SCHOOL_MODE,
        daysOfWeek = days,
        start = TimeOfDay(8, 0),
        end = TimeOfDay(16, 0),
        appScope = scope,
        timezone = "UTC",
    )

    private fun policy(windows: List<ScheduleWindow>, revision: Int = 1) = SchedulePolicyV1(
        policyId = "policy",
        policyRevision = revision,
        familyId = "family",
        childProfileId = "child",
        timezone = "UTC",
        windows = windows,
        bonusGrants = emptyList(),
        parentExceptions = emptyList(),
        dailyLimits = emptyList(),
        trustSetEpoch = 1,
        keyEpoch = 1,
        issuedAt = now,
        effectiveFrom = now,
    )

    private fun input(candidate: SchedulePolicyV1, lastKnownGood: SchedulePolicyV1? = null) = PolicyAcceptanceInput(
        candidatePolicy = candidate,
        lastKnownGoodPolicy = lastKnownGood,
        nowUtc = now,
        deviceTrustSetEpoch = 1,
        deviceKeyEpoch = 1,
        connectivity = Connectivity.ONLINE,
        lastPolicySyncAtUtc = now,
    )

    @Test
    fun `exact duplicate UTF-8 window identity is invalid and retains last known good`() {
        val accepted = policy(listOf(window("school")))
        val duplicate = policy(listOf(window("school"), window("school")), revision = 2)
        val reusedAcrossDays = policy(
            listOf(window("school", listOf(1)), window("school", listOf(2))),
            revision = 3,
        )

        val result = SchedulePolicyValidator.evaluate(input(duplicate, accepted))

        assertEquals(ScheduleRuntimeState.INVALID, result.state)
        assertEquals(accepted, result.effectivePolicy)
        assertEquals(
            "the same opaque window id cannot denote separate day-specific windows",
            ScheduleRuntimeState.INVALID,
            SchedulePolicyValidator.evaluate(input(reusedAcrossDays, accepted)).state,
        )
        val direct = ScheduleEvaluator.evaluate(
            ScheduleEvaluationInput(
                nowUtc = now,
                timezone = "UTC",
                appToken = "app",
                windows = duplicate.windows,
                bonusGrants = emptyList(),
                exceptions = emptyList(),
                enforcementCapability = EnforcementCapabilityState.ENFORCED,
                connectivity = Connectivity.ONLINE,
            ),
        )
        assertEquals(ScheduleDecisionKind.INVALID_CONFIG, direct.decision)
        assertTrue(direct.configErrors.orEmpty().any { it.contains("duplicate window id") })
    }

    @Test
    fun `canonically equivalent but byte-distinct UTF-8 ids remain distinct`() {
        val composed = "caf\u00e9"
        val decomposed = "cafe\u0301"
        assertTrue(composed != decomposed)

        val result = SchedulePolicyValidator.evaluate(input(policy(listOf(window(composed), window(decomposed)))))

        assertEquals(ScheduleRuntimeState.CURRENT, result.state)
    }

    @Test
    fun `unpaired surrogate window identity is rejected as invalid configuration`() {
        val malformedIdentity = window("bad\uD800id")

        assertTrue(validateScheduleWindow(malformedIdentity).any { it.contains("valid UTF-8") })
        assertEquals(ScheduleRuntimeState.INVALID, SchedulePolicyValidator.evaluate(input(policy(listOf(malformedIdentity)))).state)
    }

    @Test
    fun `repeated weekday entries retain the reference includes semantics`() {
        val one = ScheduleEvaluator.evaluate(
            ScheduleEvaluationInput(
                nowUtc = Instant.parse("2026-10-05T10:00:00Z"),
                timezone = "UTC",
                appToken = "app",
                windows = listOf(window("school", listOf(1), AppScope.Apps(emptyList()))),
                bonusGrants = emptyList(),
                exceptions = emptyList(),
                enforcementCapability = EnforcementCapabilityState.ENFORCED,
                connectivity = Connectivity.ONLINE,
            ),
        )
        val repeated = ScheduleEvaluator.evaluate(
            ScheduleEvaluationInput(
                nowUtc = Instant.parse("2026-10-05T10:00:00Z"),
                timezone = "UTC",
                appToken = "app",
                windows = listOf(window("school", listOf(1, 1), AppScope.Apps(emptyList()))),
                bonusGrants = emptyList(),
                exceptions = emptyList(),
                enforcementCapability = EnforcementCapabilityState.ENFORCED,
                connectivity = Connectivity.ONLINE,
            ),
        )

        assertEquals(one.decision, repeated.decision)
        assertEquals(one.matchedWindowIds, repeated.matchedWindowIds)
    }
}
