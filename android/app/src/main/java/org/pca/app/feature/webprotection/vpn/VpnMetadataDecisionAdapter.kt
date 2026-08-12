package org.pca.app.feature.webprotection.vpn

import org.pca.app.feature.webprotection.policy.CanonicalDomain
import org.pca.app.feature.webprotection.policy.VpnDecisionCoverage
import org.pca.app.feature.webprotection.policy.VpnDecisionOutcome
import org.pca.app.feature.webprotection.policy.VpnMetadataDecision
import org.pca.app.platform.VpnCapabilitySource
import org.pca.app.platform.VpnConnectionState

/**
 * Builds the doc 14 layer-2 [VpnMetadataDecision] this lane's
 * [org.pca.app.feature.webprotection.engine.WebFilterEngine] consumes, on
 * top of the EXISTING [VpnCapabilitySource] foundation (PCA-2) -- per that
 * interface's own "REVIEW NOTE," this class deliberately does NOT add any
 * decision-level API to [VpnCapabilitySource] itself; it only reads the
 * foundation's already-live permission/connection-state surface.
 *
 * This adapter reports [VpnDecisionOutcome.UNAVAILABLE] whenever the tunnel
 * is not actually enforcing (permission not granted, or connection state is
 * anything other than CONNECTED) -- it NEVER fabricates a BLOCKED/ALLOWED
 * network-layer verdict the tunnel did not actually produce. There is no
 * concrete on-device VpnService packet-classification implementation in this
 * lane (that is a distinct, larger PCA-5 sub-scope -- TUN interface, DNS
 * parsing, per-packet domain classification -- explicitly out of this pass;
 * see the final report's Coordinator-findings section). Consequently this
 * adapter, absent that implementation, ALWAYS currently reports
 * [VpnDecisionOutcome.UNAVAILABLE] for any domain: an honest "no network-
 * layer coverage" signal per doc 14 ("The engine must not claim a block that
 * it did not enforce"), rather than a fabricated allow/deny it cannot back.
 * [WebFilterEngine] already handles that case correctly (falls back to
 * deterministic rules, default-allow with `VPN_UNAVAILABLE` reason, never a
 * silent gate-open) -- see [org.pca.app.feature.webprotection.engine.WebFilterEngine.decide].
 *
 * No TLS interception, certificate installation, or traffic decryption
 * exists in, or is reachable from, this class -- it only reads
 * [VpnCapabilitySource]'s existing boolean/enum state.
 */
class VpnMetadataDecisionAdapter(private val vpnCapability: VpnCapabilitySource) {

    /** True only when the underlying tunnel is actually consented-to and connected -- exposed for callers/tests that want to distinguish "no tunnel" from "tunnel up but no per-domain classification yet" without this adapter fabricating a decision either way. */
    fun isTunnelEnforcing(): Boolean =
        vpnCapability.isPermissionGranted() && vpnCapability.connectionState() == VpnConnectionState.CONNECTED

    fun decisionFor(domain: CanonicalDomain): VpnMetadataDecision {
        // Regardless of tunnel state, this adapter has no per-domain classification signal
        // of its own to report yet (see class doc) -- always honestly UNAVAILABLE for THIS
        // domain, never a guessed ALLOWED/BLOCKED verdict the tunnel did not actually produce.
        return VpnMetadataDecision(domain, VpnDecisionOutcome.UNAVAILABLE, VpnDecisionCoverage.DOMAIN_ONLY)
    }
}
