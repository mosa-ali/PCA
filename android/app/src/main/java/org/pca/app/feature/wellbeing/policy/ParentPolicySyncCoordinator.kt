package org.pca.app.feature.wellbeing.policy

/**
 * Facade tying [ParentPolicyRevisionGuard] and [WellbeingPolicySyncState] together into the
 * receive/promote flow items 5 and 15 describe. Pure and stateless itself (like
 * [org.pca.app.feature.wellbeing.engine.WellbeingTriggerDispatcher], it never persists anything --
 * the caller is expected to persist every returned [ParentPolicyStateStore.Snapshot] via
 * [ParentPolicyStateStore.save] before the next call, same caller contract as the existing
 * dispatcher's doc comment already establishes for [org.pca.app.feature.wellbeing.model.NudgeRateState]).
 *
 * Two-phase by design:
 * 1. [receive] is called whenever a (decrypted, already family-membership/FTS-authorized -- doc 36
 *    section 4/11, out of this module's scope) policy payload physically arrives at the device.
 *    A revision-accepted payload never overwrites [WellbeingPolicySyncState.active] directly --
 *    it always lands in [WellbeingPolicySyncState.pending] first. This is the literal
 *    "received but not yet in effect" state item 5 asks for, and it means a policy can never be
 *    applied speculatively mid-arrival.
 * 2. [promote] moves [WellbeingPolicySyncState.pending] into
 *    [WellbeingPolicySyncState.active], if any is waiting. It is the only mutation that changes
 *    which policy actually governs dispatch, and it is trigger/rate-state-free -- see
 *    [WellbeingPolicySyncState.promote]'s doc for why that is what makes "no reconnect backlog"
 *    (item 13) hold structurally.
 *
 * A caller that wants "apply immediately on receipt" simply calls `promote()` right after
 * `receive()`; a caller that wants to stage delivery (e.g. only promote when the app is in a safe
 * foreground state) can call `promote()` later. Either way [active] never changes except through
 * this explicit second step.
 */
object ParentPolicySyncCoordinator {

    data class ReceiveResult(
        val snapshot: ParentPolicyStateStore.Snapshot,
        val outcome: RevisionOutcome,
    )

    fun receive(
        current: ParentPolicyStateStore.Snapshot,
        policy: ParentWellbeingPolicyV1,
        operationId: String,
    ): ReceiveResult {
        val guardState = current.revisionGuard
        // A receiving device does not originate commands, so it has no independent
        // "expectedRevision" of its own to assert -- it always evaluates against its own current
        // revision, which correctly reduces evaluate()'s three-way outcome to: duplicate
        // operationId -> no-op; newRevision not strictly greater than current -> stale; otherwise
        // -> accepted. See [ParentPolicyRevisionGuard.evaluate] doc.
        val outcome = ParentPolicyRevisionGuard.evaluate(
            state = guardState,
            operationId = operationId,
            expectedRevision = guardState.currentRevision,
            newRevision = policy.policyRevision,
        )
        return when (outcome) {
            is RevisionOutcome.Accepted -> {
                val updatedGuard = ParentPolicyRevisionGuard.commit(guardState, operationId, policy.policyRevision)
                val updatedSync = current.syncState.copy(
                    pending = PendingPolicy(policy, policy.policyRevision, receivedAtMonotonicNanos = 0L),
                )
                ReceiveResult(ParentPolicyStateStore.Snapshot(updatedSync, updatedGuard), outcome)
            }
            is RevisionOutcome.DuplicateNoOp, is RevisionOutcome.StaleRejected -> {
                // No-op: current snapshot returned unchanged (item 13-adjacent -- a
                // rejected/duplicate update never mutates active or pending state).
                ReceiveResult(current, outcome)
            }
        }
    }

    /** Same as [receive], but stamps [PendingPolicy.receivedAtMonotonicNanos] with the caller's
     * monotonic clock reading instead of the placeholder `0L` -- use this overload whenever the
     * caller has a [org.pca.app.foundation.MonotonicTimeSource] reading available (diagnostics,
     * "how long has this been pending" surfaces). */
    fun receiveAt(
        current: ParentPolicyStateStore.Snapshot,
        policy: ParentWellbeingPolicyV1,
        operationId: String,
        nowMonotonicNanos: Long,
    ): ReceiveResult {
        val result = receive(current, policy, operationId)
        val pending = result.snapshot.syncState.pending ?: return result
        return result.copy(
            snapshot = result.snapshot.copy(
                syncState = result.snapshot.syncState.copy(pending = pending.copy(receivedAtMonotonicNanos = nowMonotonicNanos)),
            ),
        )
    }

    /** Promotes pending -> active if present. Never touches rate state (item 13). */
    fun promote(current: ParentPolicyStateStore.Snapshot): ParentPolicyStateStore.Snapshot =
        current.copy(syncState = current.syncState.promote())
}
