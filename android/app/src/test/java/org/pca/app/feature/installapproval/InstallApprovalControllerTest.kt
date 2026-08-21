package org.pca.app.feature.installapproval

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.pca.app.platform.ProtectionMode
import org.pca.app.runtime.FakeProtectionCapabilities
import org.pca.app.runtime.schedule.PackageSuspensionExecutor

/**
 * PCA-FR-131: [InstallApprovalController.handleNewInstall] is the "detect -> maybe quarantine ->
 * request" decision step. These tests are the direct coverage for the mission's "capability
 * available -> enforced; capability unavailable -> honest non-enforced state" requirement, at the
 * PRE-decision (detection-time) half of the flow -- [InstallApprovalDecisionApplierTest] covers the
 * POST-decision (parent-decided) half.
 */
class InstallApprovalControllerTest {

    private class RecordingExecutor(private val result: Boolean = true) : PackageSuspensionExecutor {
        val calls = mutableListOf<Pair<String, Boolean>>()
        override fun setSuspended(packageName: String, suspended: Boolean): Boolean {
            calls += packageName to suspended
            return result
        }
    }

    @Test
    fun `capability available -- PROTECTED mode -- quarantines the package (real suspend call) and reports ENFORCED`() {
        val executor = RecordingExecutor()
        val controller = InstallApprovalController(
            protectionCapabilities = FakeProtectionCapabilities(ProtectionMode.PROTECTED),
            packageSuspensionExecutor = executor,
            requestIdFactory = { "req-1" },
        )

        val result = controller.handleNewInstall("com.example.newgame", "New Game", 1_000L)

        assertEquals(InstallApprovalCapabilityState.ENFORCED, result.capabilityState)
        assertEquals(listOf("com.example.newgame" to true), executor.calls)
        assertEquals("req-1", result.requestId)
        assertEquals("INSTALL_APPROVAL", result.kind)

        val detail = JSONObject(result.detail)
        assertEquals("com.example.newgame", detail.getString("installTargetPackageName"))
        assertEquals("New Game", detail.getString("installTargetAppLabel"))
        assertEquals("ENFORCED", detail.getString("installCapabilityState"))
    }

    @Test
    fun `capability unavailable -- STANDARD mode -- never calls setSuspended, and honestly reports REQUEST_ONLY, not ENFORCED`() {
        val executor = RecordingExecutor()
        val controller = InstallApprovalController(
            protectionCapabilities = FakeProtectionCapabilities(ProtectionMode.STANDARD),
            packageSuspensionExecutor = executor,
        )

        val result = controller.handleNewInstall("com.example.newgame", null, 1_000L)

        assertEquals(InstallApprovalCapabilityState.REQUEST_ONLY, result.capabilityState)
        assertTrue("a Standard Mode device must never attempt to suspend a package it has no authority over", executor.calls.isEmpty())
        assertEquals("REQUEST_ONLY", JSONObject(result.detail).getString("installCapabilityState"))
    }

    @Test
    fun `a missing app label is encoded as null, never fabricated`() {
        val controller = InstallApprovalController(
            protectionCapabilities = FakeProtectionCapabilities(ProtectionMode.STANDARD),
            packageSuspensionExecutor = RecordingExecutor(),
        )
        val result = controller.handleNewInstall("com.example.unlabeled", null, 1_000L)
        assertTrue(JSONObject(result.detail).isNull("installTargetAppLabel"))
    }

    @Test
    fun `authority lost -- DEGRADED mode -- never calls setSuspended, reports AUTHORIZATION_REQUIRED`() {
        val executor = RecordingExecutor()
        val controller = InstallApprovalController(
            protectionCapabilities = FakeProtectionCapabilities(ProtectionMode.DEGRADED),
            packageSuspensionExecutor = executor,
        )

        val result = controller.handleNewInstall("com.example.newgame", "New Game", 1_000L)

        assertEquals(InstallApprovalCapabilityState.AUTHORIZATION_REQUIRED, result.capabilityState)
        assertTrue(executor.calls.isEmpty())
    }

    @Test
    fun `NOT_SUPPORTED mode never calls setSuspended and reports NOT_SUPPORTED`() {
        val executor = RecordingExecutor()
        val controller = InstallApprovalController(
            protectionCapabilities = FakeProtectionCapabilities(ProtectionMode.NOT_SUPPORTED),
            packageSuspensionExecutor = executor,
        )

        val result = controller.handleNewInstall("com.example.newgame", "New Game", 1_000L)

        assertEquals(InstallApprovalCapabilityState.NOT_SUPPORTED, result.capabilityState)
        assertTrue(executor.calls.isEmpty())
    }

    @Test
    fun `a platform suspend failure never blocks the request from still being created`() {
        val failingExecutor = RecordingExecutor(result = false)
        val controller = InstallApprovalController(
            protectionCapabilities = FakeProtectionCapabilities(ProtectionMode.PROTECTED),
            packageSuspensionExecutor = failingExecutor,
        )

        // No exception, and a real DetectionResult is still returned even though the underlying
        // platform call reported failure -- the request itself is not gated on suspend success.
        val result = controller.handleNewInstall("com.example.newgame", "New Game", 1_000L)
        assertEquals("INSTALL_APPROVAL", result.kind)
    }
}
