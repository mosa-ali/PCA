package org.pca.app.runtime.schedule

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.emptyFlow
import org.junit.Assert.assertEquals
import org.junit.Test
import org.pca.app.foundation.WallClockTimeSource
import org.pca.app.runtime.connectivity.NetworkConnectivityObserver
import org.pca.app.runtime.port.ScheduleEnforcementOutcome
import org.pca.app.runtime.port.ScheduleRuntimeStatus
import java.time.Instant

class ScheduleFutureEffectivePolicyTest {
    private val beforeEffectiveFrom = Instant.parse("2026-10-09T12:30:00Z")
    private val effectiveFrom = Instant.parse("2026-10-09T13:00:00Z")

    private fun policy(
        revision: Int,
        effectiveFrom: Instant,
        windows: List<ScheduleWindow> = emptyList(),
    ) = SchedulePolicyV1(
        policyId = "child-schedule",
        policyRevision = revision,
        familyId = "family-1",
        childProfileId = "child-1",
        timezone = "UTC",
        windows = windows,
        bonusGrants = emptyList(),
        parentExceptions = emptyList(),
        dailyLimits = emptyList(),
        trustSetEpoch = 1,
        keyEpoch = 1,
        issuedAt = Instant.parse("2026-10-09T12:00:00Z"),
        effectiveFrom = effectiveFrom,
    )

    private fun activeBlock() = ScheduleWindow(
        id = "current-revision-block",
        kind = ScheduleWindowKind.BLOCK_PERIOD,
        daysOfWeek = (0..6).toList(),
        start = TimeOfDay(0, 0),
        end = TimeOfDay(23, 59),
        appScope = AppScope.All,
        timezone = "UTC",
    )

    private fun runtime(store: SchedulePolicyStore) = ScheduleRuntime(
        store,
        currentPolicyScopeProvider = { SchedulePolicyRuntimeScope("family-1", "child-1", 1, 1) },
    )

    @Test
    fun `future revision remains inactive across restart then activates at effectiveFrom`() {
        val current = policy(1, Instant.parse("2026-10-01T00:00:00Z"), listOf(activeBlock()))
        val scheduled = policy(2, effectiveFrom)
        val disk = DiskBackedPersistentStateStore()
        PersistentSchedulePolicyStore(disk).save(
            SchedulePolicySnapshot(
                candidatePolicy = scheduled,
                lastKnownGoodPolicy = current,
                lastPolicySyncAtUtc = beforeEffectiveFrom,
                deviceTrustSetEpoch = 1,
                deviceKeyEpoch = 1,
            ),
        )

        val restartedRuntime = runtime(PersistentSchedulePolicyStore(disk.afterProcessDeath()))
        val before = restartedRuntime.evaluate(
            beforeEffectiveFrom,
            "com.example.game",
            EnforcementCapabilityState.ENFORCED,
            Connectivity.OFFLINE,
        )
        assertEquals(ScheduleRuntimeState.CURRENT, before.runtimeState)
        assertEquals(current, before.effectivePolicy)
        assertEquals(ScheduleDecisionKind.BLOCKED_PERIOD, before.decision.decision)

        val atEffectiveFrom = restartedRuntime.evaluate(
            effectiveFrom,
            "com.example.game",
            EnforcementCapabilityState.ENFORCED,
            Connectivity.OFFLINE,
        )
        assertEquals(scheduled, atEffectiveFrom.effectivePolicy)
        assertEquals(ScheduleDecisionKind.ALLOWED, atEffectiveFrom.decision.decision)
    }

    @Test
    fun `future candidate without active fallback is not enforced early`() {
        val disk = DiskBackedPersistentStateStore()
        PersistentSchedulePolicyStore(disk).save(
            SchedulePolicySnapshot(
                candidatePolicy = policy(1, effectiveFrom, listOf(activeBlock())),
                lastKnownGoodPolicy = null,
                lastPolicySyncAtUtc = beforeEffectiveFrom,
                deviceTrustSetEpoch = 1,
                deviceKeyEpoch = 1,
            ),
        )

        var nowMillis = beforeEffectiveFrom.toEpochMilli()
        var enforcementCalls = 0
        val port = ProductionScheduleRuntimePort(
            scheduleRuntime = runtime(PersistentSchedulePolicyStore(disk.afterProcessDeath())),
            wallClockTimeSource = object : WallClockTimeSource {
                override fun currentTimeMillis(): Long = nowMillis
            },
            connectivityObserver = object : NetworkConnectivityObserver {
                override fun observe(): Flow<Boolean> = emptyFlow()
                override fun isCurrentlyOnline(): Boolean = false
            },
            enforcementCapabilityProvider = { EnforcementCapabilityState.ENFORCED },
            enforcementConsumer = object : ScheduleEnforcementConsumer {
                override fun apply(
                    packageName: String,
                    appToken: OpaqueAppToken,
                    decision: ScheduleDecision,
                    communicationSurfaces: CommunicationSafetySurfaceTokens,
                ): ScheduleEnforcementOutcome {
                    enforcementCalls++
                    return ScheduleEnforcementOutcome.APPLIED
                }
            },
        )

        assertEquals(ScheduleRuntimeStatus.NOT_READY, port.currentStatus())
        assertEquals(ScheduleEnforcementOutcome.UNAVAILABLE, port.enforce("com.example.game"))
        assertEquals(0, enforcementCalls)

        nowMillis = effectiveFrom.toEpochMilli()
        assertEquals(ScheduleRuntimeStatus.AVAILABLE, port.currentStatus())
        assertEquals(ScheduleEnforcementOutcome.APPLIED, port.enforce("com.example.game"))
        assertEquals(1, enforcementCalls)
        assertEquals(1, runtime(PersistentSchedulePolicyStore(disk.afterProcessDeath()))
            .evaluate(effectiveFrom, "com.example.game", EnforcementCapabilityState.ENFORCED, Connectivity.ONLINE)
            .effectivePolicy?.policyRevision)
    }
}
