package org.pca.app.platform

import org.junit.Assert.assertEquals
import org.junit.Test

class ProtectedModeProvisioningGateTest {
    @Test
    fun `baseline gate always reports PENDING_OWNER_DECISION -- PCA-DEC-002-014-015 remain unresolved`() {
        val gate = UnresolvedProtectedModeProvisioningGate()
        assertEquals(ProtectedModeFeasibility.PENDING_OWNER_DECISION, gate.feasibility())
    }

    @Test
    fun `authority gate proves only live device owner state`() {
        var authority = ManagedDeviceAuthority.NONE
        val gate = DeviceOwnerAuthorityGate(object : DevicePolicyCapabilitySource {
            override fun currentAuthority(): ManagedDeviceAuthority = authority
        })

        assertEquals(ProtectedModeAuthorityState.NOT_PROVEN, gate.currentState())
        authority = ManagedDeviceAuthority.PROFILE_OWNER
        assertEquals(ProtectedModeAuthorityState.NOT_PROVEN, gate.currentState())
        authority = ManagedDeviceAuthority.DEVICE_OWNER
        assertEquals(ProtectedModeAuthorityState.PROVEN, gate.currentState())
        authority = ManagedDeviceAuthority.UNAVAILABLE
        assertEquals(ProtectedModeAuthorityState.NOT_SUPPORTED, gate.currentState())
    }
}
