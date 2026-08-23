package org.pca.app.feature.installapproval

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.pca.app.platform.ProtectionMode
import org.pca.app.runtime.schedule.CommunicationSafetySurfaceTokens
import org.pca.app.runtime.schedule.EmergencyAccessFloor
import org.pca.app.runtime.schedule.PackageSuspensionExecutor

/**
 * PCA-FR-131: [InstallApprovalDecisionApplier] is where a parent's APPROVED/DENIED decision meets
 * the device's CURRENT (re-checked, never cached) capability. Direct coverage for two mission
 * requirements:
 *  - "approved != enforced when capability unavailable" (both directions: available -> enforced;
 *    unavailable -> honest non-enforced state, never silently reported as enforced).
 *  - "authority loss degrades the reported state" (Android Protected Mode authority revoked/lost
 *    between request-creation and decision-application time).
 */
class InstallApprovalDecisionApplierTest {

    private class RecordingExecutor(private val result: Boolean = true) : PackageSuspensionExecutor {
        val calls = mutableListOf<Pair<String, Boolean>>()
        override fun setSuspended(packageName: String, suspended: Boolean): Boolean {
            calls += packageName to suspended
            return result
        }
    }

    @Test
    fun `capability available -- PROTECTED -- APPROVED unsuspends the package and reports ENFORCED`() {
        val executor = RecordingExecutor()
        val outcome = InstallApprovalDecisionApplier.apply(
            packageSuspensionExecutor = executor,
            currentProtectionMode = ProtectionMode.PROTECTED,
            packageName = "com.example.newgame",
            decision = InstallApprovalDecisionApplier.Decision.APPROVED,
        )
        assertEquals(InstallApprovalCapabilityState.ENFORCED, outcome)
        assertEquals(listOf("com.example.newgame" to false), executor.calls)
    }

    @Test
    fun `capability available -- PROTECTED -- DENIED (re-)suspends the package and reports ENFORCED`() {
        val executor = RecordingExecutor()
        val outcome = InstallApprovalDecisionApplier.apply(
            packageSuspensionExecutor = executor,
            currentProtectionMode = ProtectionMode.PROTECTED,
            packageName = "com.example.newgame",
            decision = InstallApprovalDecisionApplier.Decision.DENIED,
        )
        assertEquals(InstallApprovalCapabilityState.ENFORCED, outcome)
        assertEquals(listOf("com.example.newgame" to true), executor.calls)
    }

    @Test
    fun `capability unavailable -- STANDARD -- APPROVED never calls setSuspended and honestly reports REQUEST_ONLY, not ENFORCED`() {
        val executor = RecordingExecutor()
        val outcome = InstallApprovalDecisionApplier.apply(
            packageSuspensionExecutor = executor,
            currentProtectionMode = ProtectionMode.STANDARD,
            packageName = "com.example.newgame",
            decision = InstallApprovalDecisionApplier.Decision.APPROVED,
        )
        assertEquals(InstallApprovalCapabilityState.REQUEST_ONLY, outcome)
        assertNotEquals(InstallApprovalCapabilityState.ENFORCED, outcome)
        assertTrue("Standard Mode has no authority to make a suspend call with", executor.calls.isEmpty())
    }

    @Test
    fun `capability unavailable -- STANDARD -- DENIED also never calls setSuspended, the app remains usable and that is reported honestly, not hidden`() {
        val executor = RecordingExecutor()
        val outcome = InstallApprovalDecisionApplier.apply(
            packageSuspensionExecutor = executor,
            currentProtectionMode = ProtectionMode.STANDARD,
            packageName = "com.example.newgame",
            decision = InstallApprovalDecisionApplier.Decision.DENIED,
        )
        assertEquals(InstallApprovalCapabilityState.REQUEST_ONLY, outcome)
        assertTrue(executor.calls.isEmpty())
    }

    @Test
    fun `authority lost between request and decision -- DEGRADED -- reports AUTHORIZATION_REQUIRED, never a stale ENFORCED`() {
        // Simulates: the device WAS Device Owner when the install was detected (ENFORCED at
        // request-creation time -- see InstallApprovalControllerTest), but by the time the
        // parent's decision arrives, Device Owner authority has been lost. This is the exact
        // "authority loss degrades the reported state" requirement.
        val executor = RecordingExecutor()
        val outcome = InstallApprovalDecisionApplier.apply(
            packageSuspensionExecutor = executor,
            currentProtectionMode = ProtectionMode.DEGRADED,
            packageName = "com.example.newgame",
            decision = InstallApprovalDecisionApplier.Decision.APPROVED,
        )
        assertEquals(InstallApprovalCapabilityState.AUTHORIZATION_REQUIRED, outcome)
        assertNotEquals(InstallApprovalCapabilityState.ENFORCED, outcome)
        assertTrue("no authority exists to make a real suspend call with once degraded", executor.calls.isEmpty())
    }

    @Test
    fun `NOT_SUPPORTED never calls setSuspended and reports NOT_SUPPORTED regardless of decision`() {
        val executor = RecordingExecutor()
        val outcome = InstallApprovalDecisionApplier.apply(
            packageSuspensionExecutor = executor,
            currentProtectionMode = ProtectionMode.NOT_SUPPORTED,
            packageName = "com.example.newgame",
            decision = InstallApprovalDecisionApplier.Decision.APPROVED,
        )
        assertEquals(InstallApprovalCapabilityState.NOT_SUPPORTED, outcome)
        assertTrue(executor.calls.isEmpty())
    }

    @Test
    fun `PCA-AND-003 emergency floor -- a DENIED decision for the device's current SMS transport is never suspended, and is honestly reported as ENFORCED`() {
        val executor = RecordingExecutor()
        val smsPackage = "com.example.family.messenger"
        val outcome = InstallApprovalDecisionApplier.apply(
            packageSuspensionExecutor = executor,
            currentProtectionMode = ProtectionMode.PROTECTED,
            packageName = smsPackage,
            decision = InstallApprovalDecisionApplier.Decision.DENIED,
            communicationSurfaces = CommunicationSafetySurfaceTokens(
                smsTransportTokens = setOf(EmergencyAccessFloor.opaqueTokenForPackage(smsPackage)),
            ),
        )
        assertEquals(InstallApprovalCapabilityState.ENFORCED, outcome)
        assertTrue(
            "a parent DENIED decision must never suspend the device's current SMS transport, regardless of authority",
            executor.calls.isEmpty(),
        )
    }

    @Test
    fun `PCA-AND-003 emergency floor -- an APPROVED decision for a protected surface still unsuspends normally (the floor only blocks suspension, never unsuspension)`() {
        val executor = RecordingExecutor()
        val dialerPackage = "com.example.family.dialer"
        val outcome = InstallApprovalDecisionApplier.apply(
            packageSuspensionExecutor = executor,
            currentProtectionMode = ProtectionMode.PROTECTED,
            packageName = dialerPackage,
            decision = InstallApprovalDecisionApplier.Decision.APPROVED,
            communicationSurfaces = CommunicationSafetySurfaceTokens(
                callSurfaceTokens = setOf(EmergencyAccessFloor.opaqueTokenForPackage(dialerPackage)),
            ),
        )
        assertEquals(InstallApprovalCapabilityState.ENFORCED, outcome)
        assertEquals(listOf(dialerPackage to false), executor.calls)
    }

    @Test
    fun `an ordinary package unrelated to any communication surface is still (re-)suspended normally on DENIED`() {
        val executor = RecordingExecutor()
        val outcome = InstallApprovalDecisionApplier.apply(
            packageSuspensionExecutor = executor,
            currentProtectionMode = ProtectionMode.PROTECTED,
            packageName = "com.example.newgame",
            decision = InstallApprovalDecisionApplier.Decision.DENIED,
            communicationSurfaces = CommunicationSafetySurfaceTokens(
                smsTransportTokens = setOf(EmergencyAccessFloor.opaqueTokenForPackage("com.example.family.messenger")),
            ),
        )
        assertEquals(InstallApprovalCapabilityState.ENFORCED, outcome)
        assertEquals(listOf("com.example.newgame" to true), executor.calls)
    }

    @Test
    fun `a platform suspend call that itself fails -- even under PROTECTED authority -- is reported as AUTHORIZATION_REQUIRED, never a false ENFORCED`() {
        val failingExecutor = RecordingExecutor(result = false)
        val outcome = InstallApprovalDecisionApplier.apply(
            packageSuspensionExecutor = failingExecutor,
            currentProtectionMode = ProtectionMode.PROTECTED,
            packageName = "com.example.newgame",
            decision = InstallApprovalDecisionApplier.Decision.APPROVED,
        )
        assertEquals(InstallApprovalCapabilityState.AUTHORIZATION_REQUIRED, outcome)
        assertNotEquals(InstallApprovalCapabilityState.ENFORCED, outcome)
    }

    @Test
    fun `a platform suspend call that throws is caught and reported as AUTHORIZATION_REQUIRED, never propagated or silently ENFORCED`() {
        val throwingExecutor = object : PackageSuspensionExecutor {
            override fun setSuspended(packageName: String, suspended: Boolean): Boolean = throw IllegalStateException("boom")
        }
        val outcome = InstallApprovalDecisionApplier.apply(
            packageSuspensionExecutor = throwingExecutor,
            currentProtectionMode = ProtectionMode.PROTECTED,
            packageName = "com.example.newgame",
            decision = InstallApprovalDecisionApplier.Decision.APPROVED,
        )
        assertEquals(InstallApprovalCapabilityState.AUTHORIZATION_REQUIRED, outcome)
    }
}
