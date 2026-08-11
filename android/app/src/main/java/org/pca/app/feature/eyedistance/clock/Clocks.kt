package org.pca.app.feature.eyedistance.clock

/**
 * PCA-8's own narrow monotonic-time port, mirroring PCA-3's `feature.screentime.clock.Clocks`
 * pattern: engine code depends only on this minimal interface, never on PCA-2's broader
 * `MonotonicTimeSource` directly, and never on wall-clock time for any duration/enforcement
 * decision (doc 13: monotonic timing only, never wall clock, for duration enforcement).
 */
fun interface MonotonicClock {
    fun elapsedNanos(): Long
}

/** Reserved for the few genuinely calendar-relevant fields (e.g. a persisted snapshot's
 * advisory wall-clock timestamp) -- never used for duration math. */
fun interface WallClock {
    fun currentTimeMillis(): Long
}
