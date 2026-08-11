package org.pca.app.feature.screentime.clock

import org.pca.app.foundation.MonotonicTimeSource

/**
 * Coordinator integration adapter: wraps PCA-2's [MonotonicTimeSource] (the platform-owned
 * monotonic clock, doc 06 Section 5) behind PCA-3's [MonotonicClock] port. Pure unit
 * delegation only -- no policy, no caching, no fallback logic -- both sides already agree the
 * underlying clock (`SystemClock.elapsedRealtimeNanos`) is the same source; this class exists
 * only so PCA-3's engine code depends on its own narrow port rather than PCA-2's broader one.
 */
class MonotonicClockBridge(
    private val timeSource: MonotonicTimeSource,
) : MonotonicClock {
    override fun elapsedNanos(): Long = timeSource.elapsedRealtimeNanos()
}
