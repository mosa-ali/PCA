package org.pca.app.platform

/**
 * Real, AppOps-backed usage-access permission states (doc 06 Section 5).
 * These map 1:1 to genuine `android.app.AppOpsManager` MODE_* values this
 * platform actually returns for the usage-stats op -- no state below is
 * invented or inferred beyond what AppOps itself reports:
 *  - [GRANTED]: MODE_ALLOWED. The app currently has usage-access.
 *  - [DENIED]: MODE_IGNORED, MODE_ERRORED, or any mode this adapter does
 *    not otherwise recognize (a conservative, fail-closed default -- an
 *    unrecognized mode is never treated as GRANTED). The user (or a
 *    policy) has refused/blocked the op, OR the platform reported a mode
 *    this adapter does not have a more specific mapping for. Android does
 *    NOT distinguish "never granted" from "revoked after being granted"
 *    at the AppOps query level -- detecting a GRANTED -> DENIED
 *    TRANSITION (doc 06's "revocation must be detected as a tamper/
 *    degraded signal" requirement) is the CALLER's responsibility, built
 *    by comparing successive snapshots of this state over time; this
 *    interface only reports the current snapshot honestly, it does not
 *    itself remember history.
 *  - [NOT_CONFIGURED]: MODE_DEFAULT. The user has never visited Settings
 *    to decide either way -- distinct from an active refusal.
 *  - [UNAVAILABLE]: the AppOpsManager system service itself could not be
 *    obtained (a genuinely abnormal platform condition, not a normal
 *    permission state) -- surfaced distinctly so a caller never conflates
 *    "the OS won't even let me check" with "the OS said no."
 *
 * Deliberately NOT modeled here (would be inventing a distinction Android
 * cannot actually observe via this API): a "DEGRADED" permission state.
 * Android exposes no API that reports "usage-stats collection is degraded"
 * as a first-class signal -- the closest real, observable proxy is
 * [queryEventsSince] returning an empty or suspiciously sparse result
 * despite [GRANTED] access, which a caller (e.g. PCA-4) can interpret
 * against its own expected cadence. Fabricating a DEGRADED enum value
 * here would imply a certainty this adapter cannot actually back with
 * platform evidence.
 */
enum class UsageAccessState { GRANTED, DENIED, NOT_CONFIGURED, UNAVAILABLE }

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
 *  - usage-access state is a real, multi-valued AppOps snapshot (see
 *    [UsageAccessState]), re-queried live on every call, NEVER cached
 *    (same anti-caching discipline as [PlatformProtectionCapabilities]) --
 *    a caller detects revocation-as-tamper-signal by diffing successive
 *    calls, not by this interface remembering state itself.
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
    fun accessState(): UsageAccessState
    fun queryEventsSince(elapsedRealtimeMillis: Long): List<UsageEvent>
}
