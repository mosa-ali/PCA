package org.pca.app.feature.screentime.engine

import kotlin.time.Duration

/** What a [ParentAuthorization] permits the holder to do. */
enum class ParentOverrideScope {
    SKIP_BREAK,
    GRANT_TIME,
}

/**
 * A parent-issued authorization for a single override action. Unlike the core engine's duration
 * accounting (which is strictly monotonic-clock-driven and must resist wall-clock tampering),
 * authorization validity is inherently a wall-clock concept — it is issued by a parent at a
 * real moment in time and is only meaningful for a bounded real-world window — so its
 * freshness is checked against wall-clock time supplied by the caller, not the monotonic clock.
 * A caller cannot forge validity by winding the device clock forward, because [expiresAtEpochMillis]
 * is itself part of the signed/issued authorization, not derived from the device's current clock.
 */
data class ParentAuthorization(
    /** Stable identifier/reference for the approving parent (account id, not a display name). */
    val approverId: String,
    val scope: ParentOverrideScope,
    /** Upper bound on how much this authorization may grant. For [ParentOverrideScope.GRANT_TIME]
     * this bounds the extra active-time duration; for [ParentOverrideScope.SKIP_BREAK] it is
     * unused but still required to keep the authorization shape uniform and auditable. */
    val boundedDuration: Duration,
    val issuedAtEpochMillis: Long,
    val expiresAtEpochMillis: Long,
    /** Correlates this authorization with an entry in the parent-facing audit log. */
    val auditId: String,
) {
    init {
        require(approverId.isNotBlank()) { "approverId must not be blank" }
        require(auditId.isNotBlank()) { "auditId must not be blank" }
        require(expiresAtEpochMillis > issuedAtEpochMillis) { "expiresAtEpochMillis must be after issuedAtEpochMillis" }
        require(!boundedDuration.isNegative()) { "boundedDuration must not be negative" }
    }
}

/** Ends the current break immediately without waiting out the remainder. */
data class SkipBreakRequest(
    val nowNanos: Long,
    val nowWallClockMillis: Long,
    val authorization: ParentAuthorization,
)

/** Pushes back the active-threshold crossing point by [extra], bounded by the authorization. */
data class GrantTimeRequest(
    val nowNanos: Long,
    val nowWallClockMillis: Long,
    val authorization: ParentAuthorization,
    val extra: Duration,
)

enum class ParentOverrideRejectionReason {
    WRONG_SCOPE,
    NOT_YET_VALID,
    EXPIRED,
    NOT_IN_BREAK_SHIELD,
    NOT_ACTIVE,
    EXTRA_DURATION_EXCEEDS_BOUND,
}

/**
 * Explicit typed outcome of a parent-override request — deliberately not a bare unchanged
 * state, so a rejected (e.g. expired, wrong scope, or applied while not in the mode it targets)
 * request can never be mistaken for a silent no-op by a caller that forgot to check.
 */
sealed interface ParentOverrideResult {
    val state: ScreenTimeState
    val auditId: String

    data class Applied(override val state: ScreenTimeState, override val auditId: String) : ParentOverrideResult

    data class Rejected(
        override val state: ScreenTimeState,
        val reason: ParentOverrideRejectionReason,
        override val auditId: String,
    ) : ParentOverrideResult
}

/**
 * Parent-override handling, kept separate from [ScreenTimeEngine.reduce] because these actions
 * carry authorization metadata and must surface an explicit [ParentOverrideResult] rather than
 * silently no-op when the request is invalid or arrives in the wrong state.
 */
object ParentOverrideEngine {

    fun applySkipBreakRequest(
        state: ScreenTimeState,
        request: SkipBreakRequest,
        config: ScreenTimeConfig = ScreenTimeConfig(),
    ): ParentOverrideResult {
        val advanced = ScreenTimeEngine.advance(state, request.nowNanos, config)
        val auth = request.authorization

        rejectionFor(auth, request.nowWallClockMillis, ParentOverrideScope.SKIP_BREAK)?.let {
            return ParentOverrideResult.Rejected(advanced, it, auth.auditId)
        }
        if (advanced.mode != ScreenTimeMode.BREAK_SHIELD) {
            return ParentOverrideResult.Rejected(advanced, ParentOverrideRejectionReason.NOT_IN_BREAK_SHIELD, auth.auditId)
        }

        val applied = advanced.copy(
            mode = ScreenTimeMode.ACTIVE,
            activeElapsedNanos = 0L,
            breakElapsedNanos = 0L,
            overriddenBreakCount = advanced.overriddenBreakCount + 1,
        )
        return ParentOverrideResult.Applied(applied, auth.auditId)
    }

    fun applyGrantTimeRequest(
        state: ScreenTimeState,
        request: GrantTimeRequest,
        config: ScreenTimeConfig = ScreenTimeConfig(),
    ): ParentOverrideResult {
        val advanced = ScreenTimeEngine.advance(state, request.nowNanos, config)
        val auth = request.authorization

        rejectionFor(auth, request.nowWallClockMillis, ParentOverrideScope.GRANT_TIME)?.let {
            return ParentOverrideResult.Rejected(advanced, it, auth.auditId)
        }
        if (advanced.mode != ScreenTimeMode.ACTIVE) {
            return ParentOverrideResult.Rejected(advanced, ParentOverrideRejectionReason.NOT_ACTIVE, auth.auditId)
        }
        if (request.extra.isNegative() || request.extra > auth.boundedDuration) {
            return ParentOverrideResult.Rejected(advanced, ParentOverrideRejectionReason.EXTRA_DURATION_EXCEEDS_BOUND, auth.auditId)
        }

        val extraNanos = request.extra.inWholeNanoseconds
        val applied = advanced.copy(activeElapsedNanos = (advanced.activeElapsedNanos - extraNanos).coerceAtLeast(0L))
        return ParentOverrideResult.Applied(applied, auth.auditId)
    }

    private fun rejectionFor(
        auth: ParentAuthorization,
        nowWallClockMillis: Long,
        expectedScope: ParentOverrideScope,
    ): ParentOverrideRejectionReason? = when {
        auth.scope != expectedScope -> ParentOverrideRejectionReason.WRONG_SCOPE
        nowWallClockMillis < auth.issuedAtEpochMillis -> ParentOverrideRejectionReason.NOT_YET_VALID
        nowWallClockMillis >= auth.expiresAtEpochMillis -> ParentOverrideRejectionReason.EXPIRED
        else -> null
    }
}
