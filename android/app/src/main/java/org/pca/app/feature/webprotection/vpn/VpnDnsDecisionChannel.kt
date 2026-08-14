package org.pca.app.feature.webprotection.vpn

import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean
import org.pca.app.feature.webprotection.policy.CanonicalDomain
import org.pca.app.feature.webprotection.policy.VpnDecisionOutcome

/**
 * In-process, on-device-only bridge between a running [WebProtectionVpnService] (the ONLY producer)
 * and [VpnMetadataDecisionAdapter] (the consumer [org.pca.app.feature.webprotection.engine.WebFilterEngine]
 * reads through). Doc 14's "the engine must not claim a block that it did not enforce" requires the
 * adapter to ever report a real per-domain ALLOWED/BLOCKED outcome only once the tunnel has
 * genuinely decided one for that exact domain -- never a guess, never derived from anything other
 * than an actual DNS decision this device's own VpnService made.
 *
 * Deliberately NOT a persistence layer: no disk, no cross-process IPC, no new storage mechanism
 * (doc 5's "no new plaintext channel" and this lane's "no second rule/decision store" discipline).
 * A bounded in-memory cache that is wiped the moment enforcement stops -- exactly as volatile as the
 * tunnel's own enforcement state, so a stale decision can never outlive the tunnel that produced it.
 */
class VpnDnsDecisionChannel {
    private val enforcing = AtomicBoolean(false)
    private val decisions = ConcurrentHashMap<CanonicalDomain, VpnDecisionOutcome>()

    /** Called by [WebProtectionVpnService] as its own tunnel lifecycle changes -- mirrors the existing [org.pca.app.platform.StandardVpnCapabilitySource.updateState] convention (the service reports transitions as they actually happen). Setting `false` clears every recorded decision: an adapter reading after the tunnel stops must never see a decision from a now-dead tunnel. */
    fun setEnforcing(value: Boolean) {
        enforcing.set(value)
        if (!value) decisions.clear()
    }

    fun isEnforcing(): Boolean = enforcing.get()

    /** Recorded only for a domain this device's own tunnel actually resolved a real ALLOWED/BLOCKED verdict for (never UNAVAILABLE -- absence from this map already means that). */
    fun recordDecision(domain: CanonicalDomain, outcome: VpnDecisionOutcome) {
        if (decisions.size > MAX_ENTRIES) decisions.clear() // simple bound, never an unbounded per-domain leak across a long-running tunnel session
        decisions[domain] = outcome
    }

    /** Null means "the tunnel has not itself decided this exact domain yet" -- callers must not interpret null as ALLOWED. */
    fun decisionFor(domain: CanonicalDomain): VpnDecisionOutcome? = decisions[domain]

    private companion object {
        const val MAX_ENTRIES = 2000
    }
}
