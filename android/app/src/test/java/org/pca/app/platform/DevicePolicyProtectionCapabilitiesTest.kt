package org.pca.app.platform

import org.junit.Assert.assertEquals
import org.junit.Test

private class FakeDevicePolicyCapabilitySource(private val authority: ManagedDeviceAuthority) : DevicePolicyCapabilitySource {
    override fun currentAuthority(): ManagedDeviceAuthority = authority
}

class DevicePolicyProtectionCapabilitiesTest {
    @Test
    fun `device owner authority maps to PROTECTED mode`() {
        val capabilities = DevicePolicyProtectionCapabilities(FakeDevicePolicyCapabilitySource(ManagedDeviceAuthority.DEVICE_OWNER))
        assertEquals(ProtectionMode.PROTECTED, capabilities.currentMode())
    }

    @Test
    fun `profile owner authority maps to STANDARD mode, never PROTECTED -- doc 06 Section 7`() {
        val capabilities = DevicePolicyProtectionCapabilities(FakeDevicePolicyCapabilitySource(ManagedDeviceAuthority.PROFILE_OWNER))
        assertEquals(ProtectionMode.STANDARD, capabilities.currentMode())
    }

    @Test
    fun `no managed authority maps to STANDARD mode`() {
        val capabilities = DevicePolicyProtectionCapabilities(FakeDevicePolicyCapabilitySource(ManagedDeviceAuthority.NONE))
        assertEquals(ProtectionMode.STANDARD, capabilities.currentMode())
    }

    @Test
    fun `missing device policy service maps to NOT_SUPPORTED`() {
        val capabilities = DevicePolicyProtectionCapabilities(FakeDevicePolicyCapabilitySource(ManagedDeviceAuthority.UNAVAILABLE))
        assertEquals(ProtectionMode.NOT_SUPPORTED, capabilities.currentMode())
    }

    @Test
    fun `loss of witnessed device owner authority maps to DEGRADED`() {
        var authority = ManagedDeviceAuthority.DEVICE_OWNER
        val source = DevicePolicyAuthorityTracker(object : DevicePolicyCapabilitySource {
            override fun currentAuthority(): ManagedDeviceAuthority = authority
        })
        val capabilities = DevicePolicyProtectionCapabilities(source)

        assertEquals(ProtectionMode.PROTECTED, capabilities.currentMode())
        authority = ManagedDeviceAuthority.NONE
        assertEquals(ProtectionMode.DEGRADED, capabilities.currentMode())
    }

    @Test
    fun `mode is re-derived on every call, never cached across authority changes`() {
        var authority = ManagedDeviceAuthority.NONE
        val source = object : DevicePolicyCapabilitySource {
            override fun currentAuthority(): ManagedDeviceAuthority = authority
        }
        val capabilities = DevicePolicyProtectionCapabilities(source)
        assertEquals(ProtectionMode.STANDARD, capabilities.currentMode())
        authority = ManagedDeviceAuthority.DEVICE_OWNER
        assertEquals(ProtectionMode.PROTECTED, capabilities.currentMode())
        authority = ManagedDeviceAuthority.NONE
        // a revoked device-owner status must be reflected immediately, never a stale cached PROTECTED result
        assertEquals(ProtectionMode.STANDARD, capabilities.currentMode())
    }
}
