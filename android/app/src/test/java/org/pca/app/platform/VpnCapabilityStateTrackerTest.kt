package org.pca.app.platform

import android.content.Intent
import org.junit.Assert.assertEquals
import org.junit.Test

private class FakeVpnCapabilitySource(
    var granted: Boolean = false,
    var state: VpnConnectionState = VpnConnectionState.DISCONNECTED,
) : VpnCapabilitySource {
    override fun isPermissionGranted(): Boolean = granted
    override fun connectionState(): VpnConnectionState = state
    override fun createConsentIntentIfNeeded(): Intent? = null
}

class VpnCapabilityStateTrackerTest {
    @Test
    fun `never-consented VPN is setup state not tamper`() {
        assertEquals(
            TrackedVpnState.CONSENT_REQUIRED,
            VpnCapabilityStateTracker(FakeVpnCapabilitySource()).currentState(),
        )
    }

    @Test
    fun `connected VPN loss is degraded`() {
        val source = FakeVpnCapabilitySource(granted = true, state = VpnConnectionState.CONNECTED)
        val tracker = VpnCapabilityStateTracker(source)

        assertEquals(TrackedVpnState.CONNECTED, tracker.currentState())
        source.state = VpnConnectionState.DISCONNECTED
        assertEquals(TrackedVpnState.DEGRADED, tracker.currentState())
    }

    @Test
    fun `consent loss after connected is revoked`() {
        val source = FakeVpnCapabilitySource(granted = true, state = VpnConnectionState.CONNECTED)
        val tracker = VpnCapabilityStateTracker(source)
        tracker.currentState()

        source.granted = false
        assertEquals(TrackedVpnState.REVOKED, tracker.currentState())
    }
}
