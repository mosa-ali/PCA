package org.pca.app.runtime.schedule

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
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

        val outcome = consumer.apply("com.example.game", gameToken, blocked(), CommunicationSafetySurfaceTokens())

        assertEquals(ScheduleEnforcementOutcome.UNAVAILABLE, outcome)
        assertTrue(executor.calls.isEmpty())
    }

    @Test
    fun protectedModeSuspendsAndReleasesOrdinaryPackage() {
        val executor = RecordingExecutor()
        val consumer = consumer(ManagedDeviceAuthority.DEVICE_OWNER, executor)

        assertEquals(
            ScheduleEnforcementOutcome.APPLIED,
            consumer.apply("com.example.game", gameToken, blocked(), CommunicationSafetySurfaceTokens()),
        )
        assertEquals(
            ScheduleEnforcementOutcome.RELEASED,
            consumer.apply("com.example.game", gameToken, ScheduleDecision(ScheduleDecisionKind.ALLOWED, "outside window"), CommunicationSafetySurfaceTokens()),
        )
        assertEquals(listOf("com.example.game" to true, "com.example.game" to false), executor.calls)
    }

    @Test
    fun `ordinary platform exception reports failed enforcement`() {
        val consumer = DevicePolicyScheduleEnforcementConsumer(
            authoritySource = authority(ManagedDeviceAuthority.DEVICE_OWNER),
            packageSuspensionExecutor = object : PackageSuspensionExecutor {
                override fun setSuspended(packageName: String, suspended: Boolean): Boolean =
                    throw IllegalStateException("platform operation failed")
            },
        )

        assertEquals(
            ScheduleEnforcementOutcome.FAILED,
            consumer.apply("com.example.game", gameToken, blocked(), CommunicationSafetySurfaceTokens()),
        )
    }

    @Test
    fun `cancellation from platform enforcement propagates`() {
        val consumer = DevicePolicyScheduleEnforcementConsumer(
            authoritySource = authority(ManagedDeviceAuthority.DEVICE_OWNER),
            packageSuspensionExecutor = object : PackageSuspensionExecutor {
                override fun setSuspended(packageName: String, suspended: Boolean): Boolean =
                    throw java.util.concurrent.CancellationException("cancelled")
            },
        )

        assertThrows(java.util.concurrent.CancellationException::class.java) {
            consumer.apply("com.example.game", gameToken, blocked(), CommunicationSafetySurfaceTokens())
        }
    }

    @Test
    fun `fatal platform error propagates rather than becoming a failed outcome`() {
        val consumer = DevicePolicyScheduleEnforcementConsumer(
            authoritySource = authority(ManagedDeviceAuthority.DEVICE_OWNER),
            packageSuspensionExecutor = object : PackageSuspensionExecutor {
                override fun setSuspended(packageName: String, suspended: Boolean): Boolean =
                    throw AssertionError("fatal platform failure")
            },
        )

        assertThrows(AssertionError::class.java) {
            consumer.apply("com.example.game", gameToken, blocked(), CommunicationSafetySurfaceTokens())
        }
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
            consumer.apply("com.example.game", gameToken, blocked(), CommunicationSafetySurfaceTokens()),
        )
        authority = ManagedDeviceAuthority.NONE
        assertEquals(
            ScheduleEnforcementOutcome.UNAVAILABLE,
            consumer.apply("com.example.game", gameToken, blocked(), CommunicationSafetySurfaceTokens()),
        )
        assertEquals(listOf("com.example.game" to true), executor.calls)
    }

    @Test
    fun communicationSurfacesArePreservedWithoutGenericAllowlist() {
        val executor = RecordingExecutor()
        val consumer = consumer(ManagedDeviceAuthority.DEVICE_OWNER, executor)
        // Production always derives appToken from packageName via
        // EmergencyAccessFloor.opaqueTokenForPackage (see
        // ProductionScheduleRuntimePort.kt) -- a caller can never present an
        // arbitrary literal token for an arbitrary package, so each surface
        // here uses its own real package/token pair rather than one shared
        // package with three unrelated literal tokens.
        val emergencyPackage = "com.android.dialer"
        val callPackage = "com.example.callapp"
        val smsPackage = "com.example.smsapp"
        val emergencyToken = EmergencyAccessFloor.opaqueTokenForPackage(emergencyPackage)
        val callToken = EmergencyAccessFloor.opaqueTokenForPackage(callPackage)
        val smsToken = EmergencyAccessFloor.opaqueTokenForPackage(smsPackage)
        val surfaces = CommunicationSafetySurfaceTokens(
            emergencySurfaceTokens = setOf(emergencyToken),
            callSurfaceTokens = setOf(callToken),
            smsTransportTokens = setOf(smsToken),
        )

        for ((packageName, token) in listOf(emergencyPackage to emergencyToken, callPackage to callToken, smsPackage to smsToken)) {
            assertEquals(
                ScheduleEnforcementOutcome.PRESERVED_SAFETY_SURFACE,
                consumer.apply(packageName, token, blocked(), surfaces),
            )
        }
        assertTrue(executor.calls.isEmpty())
    }

    // Real production callers always compute appToken this way (see
    // ProductionScheduleRuntimePort.kt) -- a fixed literal like "game-token"
    // can never satisfy DevicePolicyScheduleEnforcementConsumer's
    // package/token correspondence check (PCA-AND-003A anti-spoofing).
    private val gameToken = EmergencyAccessFloor.opaqueTokenForPackage("com.example.game")

    private fun consumer(authority: ManagedDeviceAuthority, executor: RecordingExecutor) =
        DevicePolicyScheduleEnforcementConsumer(
            authoritySource = object : DevicePolicyCapabilitySource {
                override fun currentAuthority(): ManagedDeviceAuthority = authority
            },
            packageSuspensionExecutor = executor,
        )

    private fun authority(authority: ManagedDeviceAuthority) = object : DevicePolicyCapabilitySource {
        override fun currentAuthority(): ManagedDeviceAuthority = authority
    }

    private fun blocked() = ScheduleDecision(ScheduleDecisionKind.BLOCKED_BEDTIME, "night")

    private class RecordingExecutor : PackageSuspensionExecutor {
        val calls = mutableListOf<Pair<String, Boolean>>()

        override fun setSuspended(packageName: String, suspended: Boolean): Boolean {
            calls += packageName to suspended
            return true
        }
    }
}
