package org.pca.app.platform

import org.junit.Assert.assertEquals
import org.junit.Test

class DevicePolicyCapabilityLifecycleTest {
    @Test
    fun `a live query failure is unavailable and never inferred as standard mode`() {
        val tracker = DevicePolicyAuthorityTracker(object : DevicePolicyCapabilitySource {
            override fun currentAuthority(): ManagedDeviceAuthority = error("DPM query failed")
        })

        assertEquals(ManagedDeviceAuthority.UNAVAILABLE, tracker.currentAuthority())
        assertEquals(TrackedDevicePolicyState.UNAVAILABLE, tracker.currentState())
        assertEquals(
            ProtectionMode.NOT_SUPPORTED,
            DevicePolicyProtectionCapabilities(tracker).currentMode(),
        )
    }

    @Test
    fun `authority loss and recovery are always derived from the next live DPM observation`() {
        var authority = ManagedDeviceAuthority.DEVICE_OWNER
        val tracker = DevicePolicyAuthorityTracker(object : DevicePolicyCapabilitySource {
            override fun currentAuthority(): ManagedDeviceAuthority = authority
        })

        assertEquals(TrackedDevicePolicyState.DEVICE_OWNER, tracker.currentState())
        authority = ManagedDeviceAuthority.NONE
        assertEquals(TrackedDevicePolicyState.DEVICE_OWNER_REVOKED, tracker.currentState())
        authority = ManagedDeviceAuthority.DEVICE_OWNER
        assertEquals(TrackedDevicePolicyState.DEVICE_OWNER, tracker.currentState())
    }

    @Test
    fun `query failure after device owner proof is distinct from actual revocation`() {
        var authority = ManagedDeviceAuthority.DEVICE_OWNER
        val tracker = DevicePolicyAuthorityTracker(object : DevicePolicyCapabilitySource {
            override fun currentAuthority(): ManagedDeviceAuthority = authority
        })

        tracker.currentState()
        authority = ManagedDeviceAuthority.UNAVAILABLE

        assertEquals(TrackedDevicePolicyState.DEVICE_OWNER_UNVERIFIABLE, tracker.currentState())
    }
}
