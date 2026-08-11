package org.pca.app.feature.screentime.engine

import org.pca.app.feature.screentime.persistence.UsedAuthorizationStore
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
    /** The same [ParentAuthorization.auditId] has already successfully authorized an action —
     * a bounded, signed authorization is single-use and cannot be replayed, even within its
     * validity window. */
    ALREADY_USED,
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
 *
 * Both entry points require a [UsedAuthorizationStore] so single-use replay protection is never
 * accidentally left to volatile memory: an authorization must win [UsedAuthorizationStore.claimAuthorization]
 * before it can authorize anything, so the same signed [ParentAuthorization.auditId] cannot
 * authorize a second action even across a process restart (as long as the caller binds a durable
 * store) or from two concurrent callers racing the same id (the claim itself is atomic — see
 * [UsedAuthorizationStore]).
 *
 * The claim is attempted only *after* scope/expiry/mode validation, not before: a request that
 * fails validation (wrong scope, expired, wrong mode, over-bound) never touches the store, since
 * it never actually accomplished anything. Only a request that has already passed every other
 * check — and then wins the atomic claim — becomes [ParentOverrideResult.Applied]; if it loses
 * the claim (because a concurrent request already consumed the same id), it is rejected as
 * [ParentOverrideRejectionReason.ALREADY_USED] just like an ordinary replay.
 */
object ParentOverrideEngine {

    fun applySkipBreakRequest(
        state: ScreenTimeState,
        request: SkipBreakRequest,
        usedAuthorizations: UsedAuthorizationStore,
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
        if (!usedAuthorizations.claimAuthorization(auth.auditId)) {
            return ParentOverrideResult.Rejected(advanced, ParentOverrideRejectionReason.ALREADY_USED, auth.auditId)
        }

        val applied = advanced.copy(
            mode = ScreenTimeMode.ACTIVE,
            activeElapsedNanos = 0L,
            breakElapsedNanos = 0L,
            // Same rule as a natural completion: dhikr interaction belongs to the break session
            // it happened in and must not survive past it, however the break ended.
            dhikrInteractionCount = 0,
            overriddenBreakCount = advanced.overriddenBreakCount + 1,
        )
        return ParentOverrideResult.Applied(applied, auth.auditId)
    }

    fun applyGrantTimeRequest(
        state: ScreenTimeState,
        request: GrantTimeRequest,
        usedAuthorizations: UsedAuthorizationStore,
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
        if (!usedAuthorizations.claimAuthorization(auth.auditId)) {
            return ParentOverrideResult.Rejected(advanced, ParentOverrideRejectionReason.ALREADY_USED, auth.auditId)
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
