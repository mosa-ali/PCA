package org.pca.app.runtime.schedule

import java.time.Instant
import java.util.concurrent.CancellationException
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.emptyFlow
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.pca.app.foundation.WallClockTimeSource
import org.pca.app.runtime.connectivity.NetworkConnectivityObserver
import org.pca.app.runtime.port.ScheduleEnforcementOutcome

class ProductionScheduleRuntimePortAvailabilityTest {
    private val now = Instant.parse("2026-01-07T12:00:00Z")

    private fun scheduleRuntime(): ScheduleRuntime {
        val policy = SchedulePolicyV1(
            policyId = "policy-1",
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
            issuedAt = now,
            effectiveFrom = now,
        )
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
        return ScheduleRuntime(store)
    }

    private fun port(
        surfacesProvider: () -> CommunicationSafetySurfaceTokens,
        consumer: ScheduleEnforcementConsumer,
    ) = ProductionScheduleRuntimePort(
        scheduleRuntime = scheduleRuntime(),
        wallClockTimeSource = object : WallClockTimeSource {
            override fun currentTimeMillis(): Long = now.toEpochMilli()
        },
        connectivityObserver = object : NetworkConnectivityObserver {
            override fun observe(): Flow<Boolean> = emptyFlow()
            override fun isCurrentlyOnline(): Boolean = false
        },
        communicationSurfacesProvider = surfacesProvider,
        enforcementConsumer = consumer,
    )

    @Test
    fun `available communication snapshot reaches enforcement consumer`() {
        val tokens = CommunicationSafetySurfaceTokens(
            emergencySurfaceTokens = setOf("com.example.emergency"),
            callSurfaceTokens = setOf("com.example.call"),
            smsTransportTokens = setOf("com.example.sms"),
        )
        var received: CommunicationSafetySurfaceTokens? = null
        val consumer = object : ScheduleEnforcementConsumer {
            override fun apply(
                packageName: String,
                appToken: OpaqueAppToken,
                decision: ScheduleDecision,
                communicationSurfaces: CommunicationSafetySurfaceTokens,
            ): ScheduleEnforcementOutcome {
                received = communicationSurfaces
                return ScheduleEnforcementOutcome.APPLIED
            }
        }

        assertEquals(ScheduleEnforcementOutcome.APPLIED, port({ tokens }, consumer).enforce("com.example.game"))
        assertEquals(tokens, received)
    }

    @Test
    fun `unavailable communication snapshot returns unavailable without invoking consumer`() {
        var consumerCalls = 0
        val consumer = object : ScheduleEnforcementConsumer {
            override fun apply(
                packageName: String,
                appToken: OpaqueAppToken,
                decision: ScheduleDecision,
                communicationSurfaces: CommunicationSafetySurfaceTokens,
            ): ScheduleEnforcementOutcome {
                consumerCalls += 1
                return ScheduleEnforcementOutcome.APPLIED
            }
        }

        val result = port({ error("communication_surface_snapshot_unavailable") }, consumer)
            .enforce("com.example.game")

        assertEquals(ScheduleEnforcementOutcome.UNAVAILABLE, result)
        assertEquals(0, consumerCalls)
    }

    @Test
    fun `communication snapshot cancellation propagates`() {
        var consumerCalls = 0
        val consumer = object : ScheduleEnforcementConsumer {
            override fun apply(
                packageName: String,
                appToken: OpaqueAppToken,
                decision: ScheduleDecision,
                communicationSurfaces: CommunicationSafetySurfaceTokens,
            ): ScheduleEnforcementOutcome {
                consumerCalls += 1
                return ScheduleEnforcementOutcome.APPLIED
            }
        }

        var cancellationObserved = false
        try {
            port({ throw CancellationException("cancel_enforcement") }, consumer).enforce("com.example.game")
        } catch (cancelled: CancellationException) {
            cancellationObserved = cancelled.message == "cancel_enforcement"
        }

        assertTrue(cancellationObserved)
        assertEquals(0, consumerCalls)
    }
}
