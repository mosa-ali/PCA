package org.pca.app.feature.eyedistance.clock

import org.pca.app.foundation.MonotonicTimeSource

/**
 * Coordinator integration adapter: wraps PCA-2's [MonotonicTimeSource] behind PCA-8's own
 * [MonotonicClock] port. Pure unit delegation only -- no policy, no caching, no fallback --
 * identical pattern to PCA-3's `screentime.clock.MonotonicClockBridge`.
 */
class MonotonicClockBridge(
    private val timeSource: MonotonicTimeSource,
) : MonotonicClock {
    override fun elapsedNanos(): Long = timeSource.elapsedRealtimeNanos()
}
