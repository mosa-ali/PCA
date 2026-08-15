package org.pca.app.feature.removaldecision

import org.pca.app.foundation.WallClockTimeSource

/** Result of attempting to apply a parent decision -- distinguishes "PIN/biometric check failed" from "the requested transition itself is invalid," since a UI needs to react very differently to each (re-prompt for PIN vs. a logic/flow bug). */
sealed class RemovalDecisionOutcome {
    data class Applied(val record: RemovalDecisionRecord) : RemovalDecisionOutcome()
    data object AuthenticationRequired : RemovalDecisionOutcome()
    data class Rejected(val reason: String) : RemovalDecisionOutcome()
}

/**
 * Gap item 4's end-to-end wiring: PIN verification (items 2-3) gating the
 * state machine (this file) gating persistence/audit. `isAuthenticated`
 * is supplied by the caller (the UI layer, after it has already run the
 * [org.pca.app.security.ThrottledAdminPinVerifier] / biometric gate flow)
 * rather than this class re-implementing PIN entry -- keeps the state
 * machine's authorization concern (`is this transition legal`) separate
 * from the authentication concern (`is this really the parent`), matching
 * [RemovalDecisionStateMachine]'s own doc comment about defense in depth.
 */
class RemovalDecisionCoordinator(
    private val repository: RemovalDecisionRepository,
    private val stateMachine: RemovalDecisionStateMachine,
    private val auditRecorder: RemovalDecisionAuditRecorder,
    private val wallClock: WallClockTimeSource,
    private val deviceIdProvider: () -> String?,
) {
    /** Current record, auto-resolving an expired TEMPORARILY_DISABLE window back to KEEP_ACTIVE first (never surfaces a stale expired-but-not-yet-noticed disable as still active). Initializes to [RemovalDecisionRecord.initial] on first-ever call. */
    fun currentRecord(): RemovalDecisionRecord {
        val now = wallClock.currentTimeMillis()
        val existing = repository.load() ?: RemovalDecisionRecord.initial(now).also { repository.save(it) }
        val resolved = stateMachine.resolveExpiry(existing, now)
        if (resolved !== existing) repository.save(resolved)
        return resolved
    }

    /** A removal/disable review is being requested (e.g. the parent opened "manage protection," or the child attempted to uninstall/disable and the app intercepted it). No authentication required to REQUEST a review -- only to DECIDE one, so a child can always surface the request without needing the parent's PIN. */
    fun requestReview(): RemovalDecisionOutcome = try {
        val applied = stateMachine.requestReview(currentRecord(), wallClock.currentTimeMillis())
        repository.save(applied)
        RemovalDecisionOutcome.Applied(applied)
    } catch (e: InvalidRemovalDecisionTransitionException) {
        RemovalDecisionOutcome.Rejected(e.message ?: "invalid transition")
    }

    /** Applies KEEP_ACTIVE. [isAuthenticated] must reflect a just-completed PIN/biometric check for this exact call, never a cached "was authenticated earlier" flag. */
    fun decideKeepActive(isAuthenticated: Boolean): RemovalDecisionOutcome =
        applyDecision(isAuthenticated) { stateMachine.decideKeepActive(it, wallClock.currentTimeMillis()) }

    fun decideTemporarilyDisable(isAuthenticated: Boolean, untilEpochMillis: Long): RemovalDecisionOutcome =
        applyDecision(isAuthenticated) { stateMachine.decideTemporarilyDisable(it, wallClock.currentTimeMillis(), untilEpochMillis) }

    /** Applies ALLOW_REMOVAL and, on success, writes the audit record (gap items 4/7/8) -- the one decision outcome in this subsystem that is always audited, since it is the one that permanently gives up local protection. */
    suspend fun decideAllowRemoval(isAuthenticated: Boolean): RemovalDecisionOutcome {
        if (!isAuthenticated) return RemovalDecisionOutcome.AuthenticationRequired
        return try {
            val applied = stateMachine.decideAllowRemoval(currentRecord(), wallClock.currentTimeMillis())
            repository.save(applied)
            val deviceId = deviceIdProvider()
            if (deviceId != null) {
                auditRecorder.recordAllowRemoval(deviceId, applied.decidedAtEpochMillis)
            }
            RemovalDecisionOutcome.Applied(applied)
        } catch (e: InvalidRemovalDecisionTransitionException) {
            RemovalDecisionOutcome.Rejected(e.message ?: "invalid transition")
        }
    }

    private fun applyDecision(
        isAuthenticated: Boolean,
        transition: (RemovalDecisionRecord) -> RemovalDecisionRecord,
    ): RemovalDecisionOutcome {
        if (!isAuthenticated) return RemovalDecisionOutcome.AuthenticationRequired
        return try {
            val applied = transition(currentRecord())
            repository.save(applied)
            RemovalDecisionOutcome.Applied(applied)
        } catch (e: InvalidRemovalDecisionTransitionException) {
            RemovalDecisionOutcome.Rejected(e.message ?: "invalid transition")
        }
    }
}
