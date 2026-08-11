package org.pca.app.feature.screentime.clock

/**
 * Source of monotonic elapsed time (e.g. Android's SystemClock.elapsedRealtimeNanos()).
 * All duration math in the screen-time/break engine is driven exclusively by this port —
 * never by wall-clock time — so that changing the device date/time cannot shorten a
 * measured active session or a protective break.
 */
fun interface MonotonicClock {
    fun elapsedNanos(): Long
}

/**
 * Wall-clock time, used only for advisory/audit purposes (persistence timestamps, reboot
 * correlation heuristics). Never used to compute elapsed durations.
 */
fun interface WallClock {
    fun epochMillis(): Long
}
