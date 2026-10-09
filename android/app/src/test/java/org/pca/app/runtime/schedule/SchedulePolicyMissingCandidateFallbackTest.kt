package org.pca.app.runtime.schedule

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.emptyFlow
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test
import org.pca.app.foundation.WallClockTimeSource
import org.pca.app.runtime.connectivity.NetworkConnectivityObserver
import org.pca.app.runtime.port.ScheduleEnforcementOutcome
import org.pca.app.runtime.port.ScheduleRuntimeStatus
import java.time.Instant

class SchedulePolicyMissingCandidateFallbackTest {
    private val now = Instant.parse("2026-10-09T12:00:00Z")

    private fun policy(
        trustSetEpoch: Int = 1,
        keyEpoch: Int = 1,
        expiresAt: Instant? = null,
        windows: List<ScheduleWindow> = emptyList(),
    ) = SchedulePolicyV1(
        policyId = "policy-1",
        policyRevision = 3,
        familyId = "family-1",
        childProfileId = "child-1",
        timezone = "UTC",
        windows = windows,
        bonusGrants = emptyList(),
        parentExceptions = emptyList(),
        dailyLimits = emptyList(),
        trustSetEpoch = trustSetEpoch,
        keyEpoch = keyEpoch,
        issuedAt = Instant.parse("2026-10-01T00:00:00Z"),
        effectiveFrom = Instant.parse("2026-10-01T00:00:00Z"),
        expiresAt = expiresAt,
    )

    private fun window(days: List<Int> = (0..6).toList()) = ScheduleWindow(
        id = "accepted-window",
        kind = ScheduleWindowKind.BEDTIME,
        daysOfWeek = days,
        start = TimeOfDay(0, 0),
        end = TimeOfDay(23, 59),
        appScope = AppScope.All,
        timezone = "UTC",
    )

    private fun input(
        candidate: SchedulePolicyV1? = null,
        lastKnownGood: SchedulePolicyV1? = null,
        trustFloor: Int = 1,
        keyFloor: Int = 1,
    ) = PolicyAcceptanceInput(
        candidatePolicy = candidate,
        lastKnownGoodPolicy = lastKnownGood,
        nowUtc = now,
        deviceTrustSetEpoch = trustFloor,
        deviceKeyEpoch = keyFloor,
        connectivity = Connectivity.ONLINE,
        lastPolicySyncAtUtc = now,
    )

    @Test
    fun `missing candidate keeps only a structurally valid unexpired floor-current last known good`() {
        val lkg = policy()
        val accepted = SchedulePolicyValidator.evaluate(input(lastKnownGood = lkg))
        assertEquals(ScheduleRuntimeState.INVALID, accepted.state)
        assertSame(lkg, accepted.effectivePolicy)

        val expired = policy(expiresAt = now)
        val expiredResult = SchedulePolicyValidator.evaluate(input(lastKnownGood = expired))
        assertEquals(ScheduleRuntimeState.INVALID, expiredResult.state)
        assertNull(expiredResult.effectivePolicy)

        val malformed = policy(windows = listOf(window(days = emptyList())))
        val malformedResult = SchedulePolicyValidator.evaluate(input(lastKnownGood = malformed))
        assertEquals(ScheduleRuntimeState.INVALID, malformedResult.state)
        assertNull(malformedResult.effectivePolicy)

        val trustStale = SchedulePolicyValidator.evaluate(input(lastKnownGood = lkg, trustFloor = 2))
        assertEquals(ScheduleRuntimeState.EPOCH_STALE, trustStale.state)
        assertNull(trustStale.effectivePolicy)

        val keyStale = SchedulePolicyValidator.evaluate(input(lastKnownGood = lkg, keyFloor = 2))
        assertEquals(ScheduleRuntimeState.EPOCH_STALE, keyStale.state)
        assertNull(keyStale.effectivePolicy)

        val neverAccepted = SchedulePolicyValidator.evaluate(input())
        assertEquals(ScheduleRuntimeState.NO_ACCEPTED_POLICY, neverAccepted.state)
        assertNull(neverAccepted.effectivePolicy)
    }

    @Test
    fun `invalid or expired candidate cannot fall back to a stale expired or malformed last known good`() {
        val invalidCandidate = policy(windows = listOf(window(days = emptyList())))
        val expiredCandidate = policy(expiresAt = now)

        for (candidate in listOf(invalidCandidate, expiredCandidate)) {
            val validFallback = SchedulePolicyValidator.evaluate(input(candidate, policy()))
            assertEquals(ScheduleRuntimeState.INVALID, validFallback.state)
            assertTrue(validFallback.effectivePolicy?.windows?.isEmpty() == true)

            val staleFallback = SchedulePolicyValidator.evaluate(input(candidate, policy(), trustFloor = 2))
            assertEquals(ScheduleRuntimeState.INVALID, staleFallback.state)
            assertNull(staleFallback.effectivePolicy)

            val expiredFallback = SchedulePolicyValidator.evaluate(input(candidate, policy(expiresAt = now)))
            assertEquals(ScheduleRuntimeState.INVALID, expiredFallback.state)
            assertNull(expiredFallback.effectivePolicy)

            val malformedFallback = SchedulePolicyValidator.evaluate(
                input(candidate, policy(windows = listOf(window(days = emptyList())))),
            )
            assertEquals(ScheduleRuntimeState.INVALID, malformedFallback.state)
            assertNull(malformedFallback.effectivePolicy)
        }
    }

    @Test
    fun `production port continues enforcing eligible last known good and refuses stale fallback`() {
        val lkg = policy(windows = listOf(window()))
        val currentStore = InMemorySchedulePolicyStore().apply {
            save(SchedulePolicySnapshot(null, lkg, now, 1, 1))
        }
        var appliedDecision: ScheduleDecision? = null
        val currentPort = port(ScheduleRuntime(currentStore)) { decision ->
            appliedDecision = decision
            ScheduleEnforcementOutcome.APPLIED
        }

        val result = ScheduleRuntime(currentStore).evaluate(
            nowUtc = now,
            appToken = "com.example.game",
            enforcementCapability = EnforcementCapabilityState.ENFORCED,
            connectivity = Connectivity.ONLINE,
        )
        assertEquals(ScheduleRuntimeState.INVALID, result.runtimeState)
        assertSame(lkg, result.effectivePolicy)
        assertEquals(ScheduleDecisionKind.BLOCKED_BEDTIME, result.decision.decision)
        assertEquals(ScheduleRuntimeStatus.AVAILABLE, currentPort.currentStatus())
        assertEquals(ScheduleEnforcementOutcome.APPLIED, currentPort.enforce("com.example.game"))
        assertEquals(ScheduleDecisionKind.BLOCKED_BEDTIME, appliedDecision?.decision)

        val staleStore = InMemorySchedulePolicyStore().apply {
            save(SchedulePolicySnapshot(null, lkg, now, 2, 1))
        }
        var staleEnforcementCalls = 0
        val stalePort = port(ScheduleRuntime(staleStore)) {
            staleEnforcementCalls++
            ScheduleEnforcementOutcome.APPLIED
        }

        assertEquals(ScheduleRuntimeStatus.EPOCH_STALE, stalePort.currentStatus())
        assertEquals(ScheduleEnforcementOutcome.UNAVAILABLE, stalePort.enforce("com.example.game"))
        assertEquals(0, staleEnforcementCalls)
    }

    private fun port(
        runtime: ScheduleRuntime,
        onApply: (ScheduleDecision) -> ScheduleEnforcementOutcome,
    ) = ProductionScheduleRuntimePort(
        scheduleRuntime = runtime,
        wallClockTimeSource = object : WallClockTimeSource {
            override fun currentTimeMillis(): Long = now.toEpochMilli()
        },
        connectivityObserver = object : NetworkConnectivityObserver {
            override fun observe(): Flow<Boolean> = emptyFlow()
            override fun isCurrentlyOnline(): Boolean = true
        },
        enforcementConsumer = object : ScheduleEnforcementConsumer {
            override fun apply(
                packageName: String,
                appToken: OpaqueAppToken,
                decision: ScheduleDecision,
                communicationSurfaces: CommunicationSafetySurfaceTokens,
            ): ScheduleEnforcementOutcome = onApply(decision)
        },
    )
}
