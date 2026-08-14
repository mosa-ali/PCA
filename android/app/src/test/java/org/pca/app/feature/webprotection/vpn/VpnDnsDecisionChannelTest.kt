package org.pca.app.feature.webprotection.vpn

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.pca.app.feature.webprotection.policy.VpnDecisionOutcome

class VpnDnsDecisionChannelTest {

    @Test
    fun `defaults to not enforcing, with no recorded decisions`() {
        val channel = VpnDnsDecisionChannel()
        assertFalse(channel.isEnforcing())
        assertNull(channel.decisionFor("anything.example"))
    }

    @Test
    fun `recorded decisions are readable back exactly`() {
        val channel = VpnDnsDecisionChannel()
        channel.setEnforcing(true)
        channel.recordDecision("blocked.example", VpnDecisionOutcome.BLOCKED)
        channel.recordDecision("allowed.example", VpnDecisionOutcome.ALLOWED)

        assertEquals(VpnDecisionOutcome.BLOCKED, channel.decisionFor("blocked.example"))
        assertEquals(VpnDecisionOutcome.ALLOWED, channel.decisionFor("allowed.example"))
        assertNull(channel.decisionFor("never-queried.example"))
    }

    @Test
    fun `setEnforcing false clears every recorded decision -- a stale tunnel can never leak a decision to a later session`() {
        val channel = VpnDnsDecisionChannel()
        channel.setEnforcing(true)
        channel.recordDecision("blocked.example", VpnDecisionOutcome.BLOCKED)

        channel.setEnforcing(false)

        assertFalse(channel.isEnforcing())
        assertNull(channel.decisionFor("blocked.example"))
    }

    @Test
    fun `re-enforcing after a stop starts with a clean slate`() {
        val channel = VpnDnsDecisionChannel()
        channel.setEnforcing(true)
        channel.recordDecision("old.example", VpnDecisionOutcome.ALLOWED)
        channel.setEnforcing(false)

        channel.setEnforcing(true)

        assertTrue(channel.isEnforcing())
        assertNull(channel.decisionFor("old.example"))
    }
}
