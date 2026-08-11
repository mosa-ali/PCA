package org.pca.app.foundation

import android.os.SystemClock

/**
 * Monotonic time source for duration/interval measurement (doc 06 Section 5,
 * PCA-AND-002): elapsedRealtime-based, immune to wall-clock adjustment (user
 * changing the date, NTP correction, timezone change, clock rollback). Any
 * code measuring how much time has passed between two points MUST depend on
 * this interface, never read `System.currentTimeMillis()` directly for that
 * purpose -- doc 06 explicitly calls this out as an anti-clock-rollback
 * requirement, not a style preference.
 */
interface MonotonicTimeSource {
    /** Milliseconds since an arbitrary, boot-relative origin. Only meaningful as a DIFFERENCE between two calls -- never treat the raw value as a timestamp. */
    fun elapsedRealtimeMillis(): Long
}

/**
 * Wall-clock time source for real calendar timestamps (e.g. "issuedAt" on an
 * outbound record, a UI-displayed date). Reserve this for values that
 * genuinely need to be a calendar instant -- never for duration/elapsed-time
 * math, where [MonotonicTimeSource] is required instead.
 */
interface WallClockTimeSource {
    fun currentTimeMillis(): Long
}

class SystemMonotonicTimeSource : MonotonicTimeSource {
    override fun elapsedRealtimeMillis(): Long = SystemClock.elapsedRealtime()
}

class SystemWallClockTimeSource : WallClockTimeSource {
    override fun currentTimeMillis(): Long = System.currentTimeMillis()
}
