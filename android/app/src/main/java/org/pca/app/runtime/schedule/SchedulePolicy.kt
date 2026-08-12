package org.pca.app.runtime.schedule

import java.time.Instant

typealias OpaqueAppToken = String

/**
 * Mirrors `backend/src/schedule/types.ts`'s `AppScope` union (`'ALL' | { apps: string[] }`) as a
 * sealed type, since Kotlin has no bare string-literal union. `AppScope.All` and
 * `AppScope.Apps(...)` are the only two conforming variants -- see
 * `contracts/schedule-runtime/SchedulePolicyV1.md`.
 */
sealed interface AppScope {
    data object All : AppScope
    data class Apps(val apps: List<OpaqueAppToken>) : AppScope
}

fun appScopeIncludes(scope: AppScope, appToken: OpaqueAppToken): Boolean = when (scope) {
    is AppScope.All -> true
    is AppScope.Apps -> scope.apps.contains(appToken)
}

data class TimeOfDay(val hour: Int, val minute: Int)

enum class ScheduleWindowKind { BEDTIME, SCHOOL_MODE, ALLOW_PERIOD, BLOCK_PERIOD }

/**
 * A recurring time-of-day window (PCA-FR-043). [daysOfWeek] lists the weekdays the window's
 * START falls on; a window whose [end] is not after [start] is interpreted as crossing midnight
 * into the following calendar day (e.g. bedtime 21:00 -> 07:00), still anchored to the day
 * [start] falls on for [daysOfWeek] matching. Field-for-field mirror of
 * `backend/src/schedule/types.ts`'s `ScheduleWindow`.
 */
data class ScheduleWindow(
    val id: String,
    val kind: ScheduleWindowKind,
    val daysOfWeek: List<WeekdayIndex>,
    val start: TimeOfDay,
    val end: TimeOfDay,
    val appScope: AppScope,
    /** IANA timezone the window's start/end are authored in -- always used for window
     * activation, independent of the evaluating device's current timezone (see the
     * `travel-does-not-relax-window-anchored-to-family-timezone` conformance vector). */
    val timezone: String,
)

/** PCA-FR-016: parent-granted or child-requested-and-approved extra time, additive on top of a
 * daily limit. Expiry is an absolute UTC instant, never a wall-clock/local-time comparison, so it
 * cannot be extended by manipulating device time zone. */
data class BonusGrant(
    val id: String,
    val appScope: AppScope,
    val extraMinutes: Int,
    val grantedAtUtc: Instant,
    val expiresAtUtc: Instant,
)

/** PCA-FR-043A: a parent-approved temporary exception that overrides an active locked window
 * (bedtime/school mode) for its stated duration. */
data class ParentException(
    val id: String,
    val appScope: AppScope,
    val startAtUtc: Instant,
    val endAtUtc: Instant,
    val reason: String,
)

/** PCA-FR-041. [anchorLocalDate] is the family-local calendar date (from [toZonedWallClock]) the
 * [usedMinutesToday] figure was accumulated against; the evaluator treats a mismatch against the
 * evaluation instant's local date as an implicit reset, it never mutates this record itself. */
data class DailyAppLimit(
    val appScope: AppScope,
    val limitMinutes: Int,
    val usedMinutesToday: Int,
    val anchorLocalDate: String,
)

enum class EnforcementCapabilityState { ENFORCED, DEGRADED, UNAVAILABLE }

enum class Connectivity { ONLINE, OFFLINE }

enum class ScheduleDecisionKind {
    ALLOWED,
    ALLOWED_BONUS,
    ALLOWED_EXCEPTION,
    BLOCKED_BEDTIME,
    BLOCKED_SCHOOL_MODE,
    BLOCKED_PERIOD,
    BLOCKED_OUTSIDE_ALLOW_PERIOD,
    BLOCKED_LIMIT_REACHED,
    ENFORCEMENT_UNAVAILABLE,
    INVALID_CONFIG,
}

data class ScheduleDecision(
    val decision: ScheduleDecisionKind,
    val reason: String,
    /** The window that produced a BLOCKED_ or ALLOWED_EXCEPTION verdict, when applicable. For
     * SCHOOL_MODE, this is the lexicographically-first id in [matchedWindowIds] -- a stable
     * pick, never insertion order. */
    val matchedWindowId: String? = null,
    /** All windows that jointly produced the verdict, when more than one contributed (currently
     * only BLOCKED_SCHOOL_MODE with multiple simultaneously-active school-mode windows). Sorted
     * by id, never by array/insertion order. */
    val matchedWindowIds: List<String>? = null,
    /** Present only for ENFORCEMENT_UNAVAILABLE: what the engine would otherwise have decided,
     * so the UI can show an honest "should be X, cannot confirm enforcement" state rather than a
     * bare unknown. */
    val intendedDecision: ScheduleDecisionKind? = null,
    val remainingMinutesToday: Int? = null,
    val configErrors: List<String>? = null,
)

data class ScheduleEvaluationInput(
    val nowUtc: Instant,
    val timezone: String,
    val appToken: OpaqueAppToken,
    val windows: List<ScheduleWindow>,
    val bonusGrants: List<BonusGrant>,
    val exceptions: List<ParentException>,
    val dailyLimit: DailyAppLimit? = null,
    val enforcementCapability: EnforcementCapabilityState,
    val connectivity: Connectivity,
    /** Last instant the device confirmed its policy set (windows/bonus/exceptions) was current
     * with the parent-authored source. Used only to label offline evaluation honestly; policy
     * enforcement itself never pauses just because the device is offline (PCA-4 offline-first:
     * don't silently relax control when disconnected). */
    val lastPolicySyncAtUtc: Instant? = null,
)

/**
 * The canonical, versioned policy document -- see `contracts/schedule-runtime/SchedulePolicyV1.md`
 * for the full field-by-field contract. This is a *container*; [ScheduleEvaluator] is fed a
 * narrower [ScheduleEvaluationInput] resolved from one field of `windows`/`bonusGrants`/
 * `parentExceptions` and the single matching entry of `dailyLimits`, per that doc's "Resolving an
 * evaluation input" section.
 */
data class SchedulePolicyV1(
    val version: String = "1",
    val policyId: String,
    val policyRevision: Int,
    val familyId: String,
    val childProfileId: String,
    val timezone: String,
    val windows: List<ScheduleWindow>,
    val bonusGrants: List<BonusGrant>,
    val parentExceptions: List<ParentException>,
    val dailyLimits: List<DailyAppLimit>,
    val trustSetEpoch: Int,
    val keyEpoch: Int,
    val issuedAt: Instant,
    val effectiveFrom: Instant,
    val expiresAt: Instant? = null,
) {
    /** See SchedulePolicyV1.md "Resolving an evaluation input". [evaluationTimezone] defaults to
     * the policy's own authored timezone but may be overridden with the device's current IANA
     * zone -- this only ever affects daily-limit local-date anchoring, never window activation. */
    fun toEvaluationInput(
        nowUtc: Instant,
        appToken: OpaqueAppToken,
        enforcementCapability: EnforcementCapabilityState,
        connectivity: Connectivity,
        lastPolicySyncAtUtc: Instant?,
        evaluationTimezone: String = timezone,
    ): ScheduleEvaluationInput = ScheduleEvaluationInput(
        nowUtc = nowUtc,
        timezone = evaluationTimezone,
        appToken = appToken,
        windows = windows,
        bonusGrants = bonusGrants,
        exceptions = parentExceptions,
        dailyLimit = dailyLimits.firstOrNull { appScopeIncludes(it.appScope, appToken) },
        enforcementCapability = enforcementCapability,
        connectivity = connectivity,
        lastPolicySyncAtUtc = lastPolicySyncAtUtc,
    )
}
