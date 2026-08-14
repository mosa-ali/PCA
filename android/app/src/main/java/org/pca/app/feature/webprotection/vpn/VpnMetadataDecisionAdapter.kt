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
 * foundation's already-live permission/connection-state surface, plus the
 * optional [decisionChannel] the concrete [WebProtectionVpnService]
 * populates in-process while it is actually running.
 *
 * This adapter reports [VpnDecisionOutcome.UNAVAILABLE] whenever the tunnel
 * is not actually enforcing (permission not granted, connection state is
 * anything other than CONNECTED, or -- new in this pass -- no
 * [decisionChannel] was supplied, or the channel itself reports it is not
 * currently enforcing) -- it NEVER fabricates a BLOCKED/ALLOWED network-layer
 * verdict the tunnel did not actually produce, and it NEVER reports a
 * decision for a domain the running tunnel has not itself resolved yet (see
 * [VpnDnsDecisionChannel.decisionFor] returning null in that case). Passing
 * `decisionChannel = null` (the default) reproduces the prior, honest
 * always-UNAVAILABLE behavior for any caller not wired to a real
 * [WebProtectionVpnService] instance -- e.g. before the service has ever run
 * in this process. [WebFilterEngine] already handles the UNAVAILABLE case
 * correctly (falls back to deterministic rules, default-allow with
 * `VPN_UNAVAILABLE` reason, never a silent gate-open) -- see
 * [org.pca.app.feature.webprotection.engine.WebFilterEngine.decide].
 *
 * No TLS interception, certificate installation, or traffic decryption
 * exists in, or is reachable from, this class -- it only reads
 * [VpnCapabilitySource]'s existing boolean/enum state and, at most, a
 * domain -> ALLOWED/BLOCKED map [decisionChannel] already computed.
 */
class VpnMetadataDecisionAdapter(
    private val vpnCapability: VpnCapabilitySource,
    private val decisionChannel: VpnDnsDecisionChannel? = null,
) {

    /** True only when the underlying tunnel is actually consented-to, connected, AND (when a [decisionChannel] is wired) the concrete [WebProtectionVpnService] itself reports it is currently enforcing -- exposed for callers/tests that want to distinguish "no tunnel" from "tunnel up but no per-domain classification yet" without this adapter fabricating a decision either way. */
    fun isTunnelEnforcing(): Boolean =
        vpnCapability.isPermissionGranted() &&
            vpnCapability.connectionState() == VpnConnectionState.CONNECTED &&
            decisionChannel?.isEnforcing() == true

    fun decisionFor(domain: CanonicalDomain): VpnMetadataDecision {
        if (!isTunnelEnforcing()) {
            // No enforcing tunnel (or none wired at all) -- honestly UNAVAILABLE for THIS domain,
            // never a guessed ALLOWED/BLOCKED verdict nothing actually enforced.
            return VpnMetadataDecision(domain, VpnDecisionOutcome.UNAVAILABLE, VpnDecisionCoverage.DOMAIN_ONLY)
        }
        // Tunnel is enforcing, but this exact domain may not have been resolved by it yet
        // (e.g. first-ever lookup racing this call) -- still honestly UNAVAILABLE, never assumed.
        val outcome = decisionChannel?.decisionFor(domain) ?: VpnDecisionOutcome.UNAVAILABLE
        return VpnMetadataDecision(domain, outcome, VpnDecisionCoverage.DOMAIN_ONLY)
    }
}
