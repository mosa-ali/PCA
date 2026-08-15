package org.pca.app.feature.removaldecision

/**
 * Thrown by [RemovalDecisionStateMachine] on any transition that is not
 * legal from the record's current [RemovalDecisionState]. A caller MUST
 * treat this as a programming/UI-flow bug (e.g. a decision button that
 * should have been disabled), never something to silently swallow --
 * silently swallowing an invalid transition here is exactly the kind of
 * "protection quietly weakens" bug this subsystem exists to prevent.
 */
class InvalidRemovalDecisionTransitionException(message: String) : IllegalStateException(message)

/**
 * Pure state-machine logic for [RemovalDecisionState] -- gap item 4's
 * "real state model." Deliberately has zero I/O (no persistence, no PIN
 * check, no audit write) so every transition rule can be unit-tested
 * without any Android/Room/PersistentStateStore dependency; callers own
 * wiring the PIN/biometric gate and persistence/audit side effects around
 * calls into this class (see [RemovalDecisionCoordinator]).
 */
class RemovalDecisionStateMachine {
    /**
     * A new removal/disable request arrives (from the child device, from a
     * parent opening the "manage protection" surface, etc.). Legal from
     * [RemovalDecisionState.KEEP_ACTIVE] or an EXPIRED
     * [RemovalDecisionState.TEMPORARILY_DISABLE] window (caller resolves
     * expiry via [resolveExpiry] before calling this, so this method never
     * needs to know the current time itself). Illegal while a request is
     * already pending, a disable window is still active, or removal has
     * already been terminally allowed.
     */
    fun requestReview(current: RemovalDecisionRecord, nowEpochMillis: Long): RemovalDecisionRecord {
        when (current.state) {
            RemovalDecisionState.KEEP_ACTIVE ->
                return RemovalDecisionRecord(state = RemovalDecisionState.PARENT_APPROVAL_REQUIRED, decidedAtEpochMillis = nowEpochMillis)

            RemovalDecisionState.TEMPORARILY_DISABLE -> {
                val until = current.temporarilyDisabledUntilEpochMillis
                    ?: throw IllegalStateException("TEMPORARILY_DISABLE record missing its deadline")
                if (nowEpochMillis < until) {
                    throw InvalidRemovalDecisionTransitionException(
                        "Cannot request a new review while an active TEMPORARILY_DISABLE window has not yet expired",
                    )
                }
                return RemovalDecisionRecord(state = RemovalDecisionState.PARENT_APPROVAL_REQUIRED, decidedAtEpochMillis = nowEpochMillis)
            }

            RemovalDecisionState.PARENT_APPROVAL_REQUIRED ->
                throw InvalidRemovalDecisionTransitionException("A review is already pending; cannot request another")

            RemovalDecisionState.ALLOW_REMOVAL ->
                throw InvalidRemovalDecisionTransitionException("ALLOW_REMOVAL is terminal; no further review can be requested")
        }
    }

    /**
     * Applies the parent's KEEP_ACTIVE decision. Callers MUST have already
     * completed PIN/biometric verification for this call -- this class has
     * no way to check that itself, it only enforces that the STATE
     * transition is legal, which is a distinct and equally necessary
     * safeguard (defense in depth: a compromised caller that skipped the
     * PIN check still cannot jump straight from KEEP_ACTIVE to
     * ALLOW_REMOVAL without first passing through PARENT_APPROVAL_REQUIRED).
     */
    fun decideKeepActive(current: RemovalDecisionRecord, nowEpochMillis: Long): RemovalDecisionRecord {
        requirePending(current)
        return RemovalDecisionRecord(state = RemovalDecisionState.KEEP_ACTIVE, decidedAtEpochMillis = nowEpochMillis)
    }

    /** Applies the parent's TEMPORARILY_DISABLE decision. [untilEpochMillis] must be strictly after [nowEpochMillis] -- a zero/negative-length window is not a meaningful temporary disable. */
    fun decideTemporarilyDisable(current: RemovalDecisionRecord, nowEpochMillis: Long, untilEpochMillis: Long): RemovalDecisionRecord {
        requirePending(current)
        require(untilEpochMillis > nowEpochMillis) { "untilEpochMillis must be in the future" }
        return RemovalDecisionRecord(
            state = RemovalDecisionState.TEMPORARILY_DISABLE,
            decidedAtEpochMillis = nowEpochMillis,
            temporarilyDisabledUntilEpochMillis = untilEpochMillis,
        )
    }

    /** Applies the parent's ALLOW_REMOVAL decision -- terminal. Callers must audit this transition (see [RemovalDecisionAuditRecorder]); this class only computes the resulting record. */
    fun decideAllowRemoval(current: RemovalDecisionRecord, nowEpochMillis: Long): RemovalDecisionRecord {
        requirePending(current)
        return RemovalDecisionRecord(state = RemovalDecisionState.ALLOW_REMOVAL, decidedAtEpochMillis = nowEpochMillis)
    }

    /**
     * Resolves an expired TEMPORARILY_DISABLE window back to KEEP_ACTIVE
     * automatically -- called by the caller (e.g. on app foreground, or
     * before evaluating enforcement) so a temporary disable NEVER silently
     * becomes a permanent one just because nothing happened to look at it.
     * A no-op (returns [current] unchanged) for every other state or a
     * still-active window.
     */
    fun resolveExpiry(current: RemovalDecisionRecord, nowEpochMillis: Long): RemovalDecisionRecord {
        if (current.state != RemovalDecisionState.TEMPORARILY_DISABLE) return current
        val until = current.temporarilyDisabledUntilEpochMillis ?: return current
        if (nowEpochMillis < until) return current
        return RemovalDecisionRecord(state = RemovalDecisionState.KEEP_ACTIVE, decidedAtEpochMillis = nowEpochMillis)
    }

    private fun requirePending(current: RemovalDecisionRecord) {
        if (current.state != RemovalDecisionState.PARENT_APPROVAL_REQUIRED) {
            throw InvalidRemovalDecisionTransitionException(
                "A decision can only be applied while PARENT_APPROVAL_REQUIRED (current state: ${current.state})",
            )
        }
    }
}
