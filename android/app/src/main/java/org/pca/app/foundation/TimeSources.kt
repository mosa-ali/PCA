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
 *
 * This is the bridge point a future PCA-3 `MonotonicClock` is expected to
 * wrap (`elapsedRealtimeNanos` -> `MonotonicClock.elapsedNanos`) -- both
 * resolutions are exposed so that bridge never needs to invent sub-
 * millisecond precision the platform genuinely provides via a real API
 * (`SystemClock.elapsedRealtimeNanos`, available since API 17, well below
 * this module's minSdk 26 floor).
 */
interface MonotonicTimeSource {
    /** Milliseconds since an arbitrary, boot-relative origin. Only meaningful as a DIFFERENCE between two calls -- never treat the raw value as a timestamp. */
    fun elapsedRealtimeMillis(): Long

    /** Nanoseconds since the same boot-relative origin as [elapsedRealtimeMillis] (same underlying clock, finer resolution) -- for a caller (e.g. a future PCA-3 MonotonicClock) that needs nanosecond-precision duration math. Only meaningful as a DIFFERENCE between two calls, same as the millisecond form. */
    fun elapsedRealtimeNanos(): Long
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
    override fun elapsedRealtimeNanos(): Long = SystemClock.elapsedRealtimeNanos()
}

class SystemWallClockTimeSource : WallClockTimeSource {
    override fun currentTimeMillis(): Long = System.currentTimeMillis()
}
