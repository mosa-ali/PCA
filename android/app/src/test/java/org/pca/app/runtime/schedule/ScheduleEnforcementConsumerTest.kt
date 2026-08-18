package org.pca.app.runtime.schedule

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.pca.app.platform.DevicePolicyCapabilitySource
import org.pca.app.platform.ManagedDeviceAuthority
import org.pca.app.runtime.port.ScheduleEnforcementOutcome

class ScheduleEnforcementConsumerTest {
    @Test
    fun standardModeNeverClaimsPackageEnforcement() {
        val executor = RecordingExecutor()
        val consumer = consumer(ManagedDeviceAuthority.NONE, executor)

        val outcome = consumer.apply("com.example.game", "game-token", blocked(), CommunicationSafetySurfaceTokens())

        assertEquals(ScheduleEnforcementOutcome.UNAVAILABLE, outcome)
        assertTrue(executor.calls.isEmpty())
    }

    @Test
    fun protectedModeSuspendsAndReleasesOrdinaryPackage() {
        val executor = RecordingExecutor()
        val consumer = consumer(ManagedDeviceAuthority.DEVICE_OWNER, executor)

        assertEquals(
            ScheduleEnforcementOutcome.APPLIED,
            consumer.apply("com.example.game", "game-token", blocked(), CommunicationSafetySurfaceTokens()),
        )
        assertEquals(
            ScheduleEnforcementOutcome.RELEASED,
            consumer.apply("com.example.game", "game-token", ScheduleDecision(ScheduleDecisionKind.ALLOWED, "outside window"), CommunicationSafetySurfaceTokens()),
        )
        assertEquals(listOf("com.example.game" to true, "com.example.game" to false), executor.calls)
    }

    @Test
    fun `authority loss between schedule ticks fails closed without a stale suspension call`() {
        var authority = ManagedDeviceAuthority.DEVICE_OWNER
        val executor = RecordingExecutor()
        val consumer = DevicePolicyScheduleEnforcementConsumer(
            authoritySource = object : DevicePolicyCapabilitySource {
                override fun currentAuthority(): ManagedDeviceAuthority = authority
            },
            packageSuspensionExecutor = executor,
        )

        assertEquals(
            ScheduleEnforcementOutcome.APPLIED,
            consumer.apply("com.example.game", "game-token", blocked(), CommunicationSafetySurfaceTokens()),
        )
        authority = ManagedDeviceAuthority.NONE
        assertEquals(
            ScheduleEnforcementOutcome.UNAVAILABLE,
            consumer.apply("com.example.game", "game-token", blocked(), CommunicationSafetySurfaceTokens()),
        )
        assertEquals(listOf("com.example.game" to true), executor.calls)
    }

    @Test
    fun communicationSurfacesArePreservedWithoutGenericAllowlist() {
        val executor = RecordingExecutor()
        val consumer = consumer(ManagedDeviceAuthority.DEVICE_OWNER, executor)
        val surfaces = CommunicationSafetySurfaceTokens(
            emergencySurfaceTokens = setOf("emergency-token"),
            callSurfaceTokens = setOf("call-token"),
            smsTransportTokens = setOf("sms-token"),
        )

        for (token in listOf("emergency-token", "call-token", "sms-token")) {
            assertEquals(
                ScheduleEnforcementOutcome.PRESERVED_SAFETY_SURFACE,
                consumer.apply("com.example.surface", token, blocked(), surfaces),
            )
        }
        assertTrue(executor.calls.isEmpty())
    }

    private fun consumer(authority: ManagedDeviceAuthority, executor: RecordingExecutor) =
        DevicePolicyScheduleEnforcementConsumer(
            authoritySource = object : DevicePolicyCapabilitySource {
                override fun currentAuthority(): ManagedDeviceAuthority = authority
            },
            packageSuspensionExecutor = executor,
        )

    private fun blocked() = ScheduleDecision(ScheduleDecisionKind.BLOCKED_BEDTIME, "night")

    private class RecordingExecutor : PackageSuspensionExecutor {
        val calls = mutableListOf<Pair<String, Boolean>>()

        override fun setSuspended(packageName: String, suspended: Boolean): Boolean {
            calls += packageName to suspended
            return true
        }
    }
}
