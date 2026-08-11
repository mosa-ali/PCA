package org.pca.app.platform

/** One raw usage event as reported by the platform (doc 06 Section 5, PCA-AND-002). Opaque to this layer -- reports what the OS reports, never classifies/interprets it (no per-app policy logic belongs here). */
data class UsageEvent(
    val packageName: String,
    val eventType: UsageEventType,
    val elapsedRealtimeMillis: Long,
)

enum class UsageEventType { FOREGROUND, BACKGROUND }

/**
 * Adapter over the platform's app-usage measurement capability
 * (UsageStatsManager on Android). Doc 06 Section 5 requirements this
 * interface exists to satisfy:
 *  - usage-access revocation MUST be detected as a tamper/degraded signal,
 *    never fail silently -- see [isAccessGranted], re-queried live, never
 *    cached (same anti-caching discipline as [PlatformProtectionCapabilities]).
 *  - events are NOT assumed gapless across reboot -- callers must treat a
 *    query as a best-effort snapshot, never a complete-history guarantee.
 *  - all timestamps this interface exposes are on the MONOTONIC
 *    (elapsed-realtime) timeline, never a raw wall-clock value -- doc 06's
 *    anti-clock-rollback requirement. A concrete implementation whose
 *    underlying platform API is wall-clock-based (as UsageStatsManager's
 *    query methods are) is responsible for converting at the boundary; it
 *    must never leak that reliance to callers.
 */
interface UsageObservationSource {
    fun isAccessGranted(): Boolean
    fun queryEventsSince(elapsedRealtimeMillis: Long): List<UsageEvent>
}
