package org.pca.app.feature.webprotection.vpn

import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong
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
    data class DecisionAttempt internal constructor(val lifecycleEpoch: Long, val generation: Long)

    private val enforcing = AtomicBoolean(false)
    private data class DecisionState(val attempt: DecisionAttempt, val outcome: VpnDecisionOutcome?)

    private val nextGeneration = AtomicLong(0)
    private val lifecycleEpoch = AtomicLong(0)
    private val decisions = ConcurrentHashMap<CanonicalDomain, DecisionState>()
    private val lifecycleLock = Any()

    /** Called by [WebProtectionVpnService] as its own tunnel lifecycle changes -- mirrors the existing [org.pca.app.platform.StandardVpnCapabilitySource.updateState] convention (the service reports transitions as they actually happen). Setting `false` clears every recorded decision: an adapter reading after the tunnel stops must never see a decision from a now-dead tunnel. */
    /**
     * Update tunnel lifecycle and return its epoch atomically. The service binds
     * this returned value to that tunnel's reader thread, so a delayed old
     * reader cannot capture a later lifecycle epoch after stop/restart.
     */
    fun setEnforcing(value: Boolean): Long = synchronized(lifecycleLock) {
        if (enforcing.get() != value) {
            lifecycleEpoch.incrementAndGet()
            enforcing.set(value)
        }
        if (!value) decisions.clear()
        lifecycleEpoch.get()
    }

    fun isEnforcing(): Boolean = enforcing.get()

    /** Capture at packet admission, before the request is queued to a worker thread. */
    fun captureLifecycleEpoch(): Long = lifecycleEpoch.get()

    /**
     * Invalidates any earlier verdict before a new DNS attempt for this domain. The returned
     * generation lets the caller publish a result only if a newer same-domain attempt has not
     * already started. A failed lookup therefore stays unavailable even when requests overlap.
     */
    fun clearDecision(
        domain: CanonicalDomain,
        expectedLifecycleEpoch: Long = captureLifecycleEpoch(),
    ): DecisionAttempt? {
        val attempt = DecisionAttempt(expectedLifecycleEpoch, nextGeneration.incrementAndGet())
        synchronized(lifecycleLock) {
            if (lifecycleEpoch.get() != expectedLifecycleEpoch) return null
            if (decisions.size > MAX_ENTRIES) decisions.clear()
            decisions.compute(domain) { _, current ->
                if (lifecycleEpoch.get() != expectedLifecycleEpoch) current
                else if (current == null || isNewer(attempt, current.attempt)) DecisionState(attempt, null)
                else current
            }
        }
        return attempt.takeIf { lifecycleEpoch.get() == expectedLifecycleEpoch }
    }

    /** Recorded only for a domain this device's own tunnel actually resolved a real ALLOWED/BLOCKED verdict for (never UNAVAILABLE -- absence from this map already means that). */
    fun recordDecision(domain: CanonicalDomain, outcome: VpnDecisionOutcome) {
        val attempt = DecisionAttempt(lifecycleEpoch.get(), nextGeneration.incrementAndGet())
        if (decisions.size > MAX_ENTRIES) decisions.clear() // simple bound, never an unbounded per-domain leak across a long-running tunnel session
        decisions.compute(domain) { _, current ->
            if (lifecycleEpoch.get() == attempt.lifecycleEpoch &&
                (current == null || isNewer(attempt, current.attempt))) {
                DecisionState(attempt, outcome)
            } else current
        }
    }

    /** Publish only the verdict for the latest attempt begun for [domain]. */
    fun recordDecision(domain: CanonicalDomain, outcome: VpnDecisionOutcome, attempt: DecisionAttempt) {
        decisions.compute(domain) { _, current ->
            if (lifecycleEpoch.get() == attempt.lifecycleEpoch && current?.attempt == attempt) {
                current.copy(outcome = outcome)
            } else current
        }
    }

    /** Null means "the tunnel has not itself decided this exact domain yet" -- callers must not interpret null as ALLOWED. */
    fun decisionFor(domain: CanonicalDomain): VpnDecisionOutcome? = decisions[domain]
        ?.takeIf { it.attempt.lifecycleEpoch == lifecycleEpoch.get() }
        ?.outcome

    private fun isNewer(left: DecisionAttempt, right: DecisionAttempt): Boolean =
        left.lifecycleEpoch > right.lifecycleEpoch ||
            left.lifecycleEpoch == right.lifecycleEpoch && left.generation > right.generation

    private companion object {
        const val MAX_ENTRIES = 2000
    }
}
