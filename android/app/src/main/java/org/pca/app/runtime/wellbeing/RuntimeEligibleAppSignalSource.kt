package org.pca.app.runtime.wellbeing

import org.pca.app.feature.wellbeing.ports.EligibleAppSignalSource
import org.pca.app.foundation.MonotonicTimeSource
import org.pca.app.platform.UsageAccessState
import org.pca.app.platform.UsageEventType
import org.pca.app.platform.UsageObservationSource
import java.security.MessageDigest

/**
 * Production [EligibleAppSignalSource] closing the gap PCA-WELL-1 explicitly left for the
 * Coordinator (see `docs/architecture/COORDINATOR_INTEGRATION_QUEUE.md` and
 * `feature/wellbeing/ports/WellbeingPorts.kt`): observes the real foreground app via PCA-4's
 * [UsageObservationSource], never fabricates an event, and reports only a stable opaque token
 * (never a human-readable app name -- PCA-WELL-027).
 *
 * Permission-aware: if usage access is not [UsageAccessState.GRANTED], this always reports null
 * (no eligible app) rather than guessing -- the dispatcher already treats "no signal" safely.
 *
 * Eligibility itself (which packages count as "high-engagement") is intentionally NOT decided
 * here -- that is family/catalogue policy, owned elsewhere. This adapter's job ends at "what is
 * the current foreground app, expressed as an opaque token, and did it just return rapidly after
 * leaving" -- [eligiblePackages] is the caller-supplied policy predicate.
 */
class RuntimeEligibleAppSignalSource(
    private val usageObservationSource: UsageObservationSource,
    private val monotonicTimeSource: MonotonicTimeSource,
    private val eligiblePackages: () -> Set<String>,
) : EligibleAppSignalSource {

    @Volatile private var lastQueryElapsedRealtimeMillis: Long = 0L
    @Volatile private var currentForegroundPackage: String? = null
    @Volatile private var lastExitElapsedRealtimeMillis: Long? = null

    override fun currentEligibleAppToken(): String? {
        if (usageObservationSource.accessState() != UsageAccessState.GRANTED) {
            currentForegroundPackage = null
            return null
        }

        val nowMillis = monotonicTimeSource.elapsedRealtimeMillis()
        val since = if (lastQueryElapsedRealtimeMillis == 0L) nowMillis else lastQueryElapsedRealtimeMillis
        val events = usageObservationSource.queryEventsSince(since)
        lastQueryElapsedRealtimeMillis = nowMillis

        // Real events only, in the order the platform reported them -- no fabrication, no
        // reordering, no synthetic FOREGROUND/BACKGROUND pair invented for a gap.
        for (event in events) {
            when (event.eventType) {
                UsageEventType.FOREGROUND -> {
                    currentForegroundPackage = event.packageName
                }
                UsageEventType.BACKGROUND -> {
                    if (event.packageName == currentForegroundPackage) {
                        lastExitElapsedRealtimeMillis = event.elapsedRealtimeMillis
                        currentForegroundPackage = null
                    }
                }
            }
        }

        val foreground = currentForegroundPackage ?: return null
        if (foreground !in eligiblePackages()) return null
        return opaqueToken(foreground)
    }

    /** Monotonic-timeline "how long ago did the eligible app last leave the foreground" -- used by
     * callers that want to distinguish a fresh open from a rapid return, without ever exposing the
     * real package name. Null if this source has not observed an exit yet this session. */
    fun millisSinceLastExit(): Long? {
        val exit = lastExitElapsedRealtimeMillis ?: return null
        return (monotonicTimeSource.elapsedRealtimeMillis() - exit).coerceAtLeast(0L)
    }

    private fun opaqueToken(packageName: String): String {
        val digest = MessageDigest.getInstance("SHA-256").digest(packageName.toByteArray(Charsets.UTF_8))
        return digest.joinToString(separator = "") { "%02x".format(it) }.take(TOKEN_LENGTH)
    }

    private companion object {
        const val TOKEN_LENGTH = 16
    }
}
