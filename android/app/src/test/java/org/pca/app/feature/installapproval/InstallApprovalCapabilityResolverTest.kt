package org.pca.app.feature.installapproval

import org.junit.Assert.assertEquals
import org.junit.Test
import org.pca.app.platform.ProtectionMode

/** PCA-FR-131: every [ProtectionMode] maps to exactly one honest [InstallApprovalCapabilityState] --
 * no branch silently falls through to ENFORCED, and PLATFORM_LIMITED is never produced by this
 * Android resolver (it exists only for cross-platform vocabulary completeness -- see
 * [InstallApprovalCapabilityState.PLATFORM_LIMITED]'s own doc comment). */
class InstallApprovalCapabilityResolverTest {

    @Test
    fun `PROTECTED -- real Device Owner authority -- resolves to ENFORCED`() {
        assertEquals(InstallApprovalCapabilityState.ENFORCED, InstallApprovalCapabilityResolver.resolve(ProtectionMode.PROTECTED))
    }

    @Test
    fun `STANDARD -- no Device Owner authority -- resolves to REQUEST_ONLY, never ENFORCED`() {
        assertEquals(InstallApprovalCapabilityState.REQUEST_ONLY, InstallApprovalCapabilityResolver.resolve(ProtectionMode.STANDARD))
    }

    @Test
    fun `DEGRADED -- authority previously proven, now lost -- resolves to AUTHORIZATION_REQUIRED, never a stale ENFORCED`() {
        assertEquals(InstallApprovalCapabilityState.AUTHORIZATION_REQUIRED, InstallApprovalCapabilityResolver.resolve(ProtectionMode.DEGRADED))
    }

    @Test
    fun `AUTHORIZATION_REQUIRED protection mode resolves to AUTHORIZATION_REQUIRED capability`() {
        assertEquals(
            InstallApprovalCapabilityState.AUTHORIZATION_REQUIRED,
            InstallApprovalCapabilityResolver.resolve(ProtectionMode.AUTHORIZATION_REQUIRED),
        )
    }

    @Test
    fun `NOT_SUPPORTED protection mode resolves to NOT_SUPPORTED capability, distinct from REQUEST_ONLY`() {
        assertEquals(InstallApprovalCapabilityState.NOT_SUPPORTED, InstallApprovalCapabilityResolver.resolve(ProtectionMode.NOT_SUPPORTED))
    }
}
