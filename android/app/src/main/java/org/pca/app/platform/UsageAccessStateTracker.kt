package org.pca.app.platform

import org.pca.app.foundation.MonotonicTimeSource

/**
 * Rich, HISTORY-AWARE usage-access state (PCA-4 consumption contract).
 * Unlike a raw point-in-time AppOps query ([UsageAccessState], which
 * cannot distinguish "never granted" from "revoked after being granted"),
 * this state IS evidence-backed by real observation history
 * [UsageAccessStateTracker] itself maintains -- REVOKED and DEGRADED are
 * never guessed, only reported when the tracker has genuine prior
 * evidence to back them.
 */
enum class TrackedUsageAccessState {
    GRANTED,
    /** Never observed as GRANTED by this tracker (or the tracker has no history yet) and AppOps currently reports non-GRANTED. */
    DENIED,
    /** This tracker PREVIOUSLY observed GRANTED, and AppOps now reports non-GRANTED -- a genuine, evidence-backed transition (doc 06's "revocation must be detected as a tamper/degraded signal"), not an inference from a single query. */
    REVOKED,
    NOT_CONFIGURED,
    /**
     * AppOps currently reports GRANTED, but the most recent observation
     * window returned zero usage events -- a real, observable (though not
     * certain) anomaly signal, not a guess about WHY. A caller may choose
     * to treat this as "access nominally fine but data pipeline may be
     * stuck," never as "access was revoked" (that remains [REVOKED]'s
     * distinct, differently-evidenced meaning).
     */
    DEGRADED,
    UNAVAILABLE,
}

/**
 * Tracks live [UsageObservationSource] state over time to translate raw,
 * stateless AppOps snapshots into the richer, evidence-backed
 * [TrackedUsageAccessState] PCA-4 needs. This is PCA-2's own Android-
 * observation-TRANSLATION responsibility; it makes NO policy decision
 * about what PCA-4 should DO in response to any state (e.g. whether to
 * warn the parent, pause enforcement, etc.) -- that remains entirely
 * PCA-4's concern.
 *
 * Fails closed: any ambiguous or incomplete observation (the underlying
 * source reporting UNAVAILABLE, or a query producing no data) is never
 * upgraded to a more favorable state than the evidence supports.
 */
class UsageAccessStateTracker(
    private val source: UsageObservationSource,
    private val monotonicTimeSource: MonotonicTimeSource,
    private val degradedObservationWindowMillis: Long = DEFAULT_DEGRADED_WINDOW_MILLIS,
) {
    private var everObservedGranted = false

    /**
     * Re-evaluates live platform state, folding in this tracker's own
     * observation history. Never caches the underlying platform query
     * itself -- every call re-queries [source] live, same anti-caching
     * discipline as every other capability adapter in this package.
     */
    fun currentState(): TrackedUsageAccessState {
        val rawState = source.accessState()
        return when (rawState) {
            UsageAccessState.GRANTED -> {
                everObservedGranted = true
                if (hasRecentEvidence()) TrackedUsageAccessState.GRANTED else TrackedUsageAccessState.DEGRADED
            }
            UsageAccessState.NOT_CONFIGURED -> TrackedUsageAccessState.NOT_CONFIGURED
            UsageAccessState.UNAVAILABLE -> TrackedUsageAccessState.UNAVAILABLE
            UsageAccessState.DENIED -> if (everObservedGranted) TrackedUsageAccessState.REVOKED else TrackedUsageAccessState.DENIED
        }
    }

    private fun hasRecentEvidence(): Boolean {
        val nowElapsed = monotonicTimeSource.elapsedRealtimeMillis()
        val windowStart = (nowElapsed - degradedObservationWindowMillis).coerceAtLeast(0)
        return source.queryEventsSince(windowStart).isNotEmpty()
    }

    private companion object {
        const val DEFAULT_DEGRADED_WINDOW_MILLIS = 30 * 60 * 1000L // 30 minutes
    }
}
