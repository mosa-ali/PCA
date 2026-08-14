package org.pca.app.feature.webprotection.vpn

import android.content.Intent
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test
import org.pca.app.feature.webprotection.policy.VpnDecisionCoverage
import org.pca.app.feature.webprotection.policy.VpnDecisionOutcome
import org.pca.app.platform.VpnCapabilitySource
import org.pca.app.platform.VpnConnectionState

private class FakeVpnCapabilitySource(
    private val granted: Boolean,
    private val state: VpnConnectionState,
) : VpnCapabilitySource {
    override fun isPermissionGranted(): Boolean = granted
    override fun connectionState(): VpnConnectionState = state
    override fun createConsentIntentIfNeeded(): Intent? = null
}

class VpnMetadataDecisionAdapterTest {

    @Test
    fun `no decision channel wired at all -- always honestly UNAVAILABLE, exactly like the prior scaffolding`() {
        val adapter = VpnMetadataDecisionAdapter(FakeVpnCapabilitySource(granted = true, state = VpnConnectionState.CONNECTED))

        val decision = adapter.decisionFor("anything.example")

        assertEquals(VpnDecisionOutcome.UNAVAILABLE, decision.outcome)
        assertEquals(VpnDecisionCoverage.DOMAIN_ONLY, decision.coverage)
        assertFalse(adapter.isTunnelEnforcing())
    }

    @Test
    fun `permission not granted -- UNAVAILABLE even if a channel reports enforcing`() {
        val channel = VpnDnsDecisionChannel().apply { setEnforcing(true) }
        val adapter = VpnMetadataDecisionAdapter(FakeVpnCapabilitySource(granted = false, state = VpnConnectionState.CONNECTED), channel)

        assertEquals(VpnDecisionOutcome.UNAVAILABLE, adapter.decisionFor("x.example").outcome)
    }

    @Test
    fun `connection state not CONNECTED -- UNAVAILABLE even if a channel reports enforcing`() {
        val channel = VpnDnsDecisionChannel().apply { setEnforcing(true) }
        val adapter = VpnMetadataDecisionAdapter(FakeVpnCapabilitySource(granted = true, state = VpnConnectionState.CONNECTING), channel)

        assertEquals(VpnDecisionOutcome.UNAVAILABLE, adapter.decisionFor("x.example").outcome)
    }

    @Test
    fun `channel reports not enforcing -- UNAVAILABLE even with permission granted and state CONNECTED`() {
        val channel = VpnDnsDecisionChannel() // setEnforcing never called -- defaults false
        val adapter = VpnMetadataDecisionAdapter(FakeVpnCapabilitySource(granted = true, state = VpnConnectionState.CONNECTED), channel)

        assertEquals(VpnDecisionOutcome.UNAVAILABLE, adapter.decisionFor("x.example").outcome)
        assertFalse(adapter.isTunnelEnforcing())
    }

    @Test
    fun `enforcing tunnel with a real recorded decision reports it truthfully`() {
        val channel = VpnDnsDecisionChannel().apply {
            setEnforcing(true)
            recordDecision("blocked.example", VpnDecisionOutcome.BLOCKED)
        }
        val adapter = VpnMetadataDecisionAdapter(FakeVpnCapabilitySource(granted = true, state = VpnConnectionState.CONNECTED), channel)

        assertEquals(VpnDecisionOutcome.BLOCKED, adapter.decisionFor("blocked.example").outcome)
        assertEquals(VpnDecisionOutcome.UNAVAILABLE, adapter.decisionFor("never-resolved.example").outcome) // enforcing, but this domain was never itself decided
    }

    @Test
    fun `setEnforcing false clears every previously recorded decision`() {
        val channel = VpnDnsDecisionChannel().apply {
            setEnforcing(true)
            recordDecision("allowed.example", VpnDecisionOutcome.ALLOWED)
        }
        channel.setEnforcing(false)

        assertEquals(null, channel.decisionFor("allowed.example"))
    }
}
