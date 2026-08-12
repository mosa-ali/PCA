package org.pca.app.feature.wellbeing.policy

/**
 * Kotlin port of `parent-sdk/wellbeing-control/src/revisionGuard.ts`'s `RevisionGuard` (doc 36
 * section 10, item 15 of the task spec). `policyRevision` is the sole authority on ordering --
 * localized text is never used as revision identity, matching the TS reference exactly. Ported as
 * pure functions over an explicit, persistable [RevisionGuardState] rather than the TS class's
 * internal mutable fields, so the state can be durably round-tripped through
 * [ParentPolicyStateStore] (item 5's offline requirement: this decision must survive process
 * death / being offline since acceptance, not just live in memory for one process lifetime).
 */
data class RevisionGuardState(
    val currentRevision: Int,
    val appliedOperationIds: Set<String> = emptySet(),
) {
    companion object {
        /** No policy has ever been accepted yet (fresh install / first sync). */
        val INITIAL = RevisionGuardState(currentRevision = 0)

        /** Bound on remembered operation IDs so offline-forever devices don't grow this set
         * unboundedly; large enough that any realistic in-flight retry/replay window is covered. */
        const val MAX_REMEMBERED_OPERATION_IDS = 500
    }
}

sealed interface RevisionOutcome {
    data class Accepted(val newRevision: Int) : RevisionOutcome
    data class DuplicateNoOp(val operationId: String) : RevisionOutcome
    data class StaleRejected(val expectedRevision: Int, val currentRevision: Int) : RevisionOutcome
}

object ParentPolicyRevisionGuard {

    /** Mirrors `RevisionGuard.evaluate` in revisionGuard.ts exactly:
     * 1. A previously-applied `operationId` is always a no-op, regardless of revision numbers
     *    (duplicate/idempotent handling, item 15).
     * 2. Otherwise, the caller's `expectedRevision` must match [RevisionGuardState.currentRevision]
     *    (stale-update rejection).
     * 3. Otherwise, `newRevision` must be strictly greater than the current revision
     *    (newer-apply acceptance; also guards against a revision that regresses or repeats without
     *    a legitimate `operationId` match). */
    fun evaluate(state: RevisionGuardState, operationId: String, expectedRevision: Int, newRevision: Int): RevisionOutcome {
        if (operationId in state.appliedOperationIds) {
            return RevisionOutcome.DuplicateNoOp(operationId)
        }
        if (expectedRevision != state.currentRevision) {
            return RevisionOutcome.StaleRejected(expectedRevision, state.currentRevision)
        }
        if (newRevision <= state.currentRevision) {
            return RevisionOutcome.StaleRejected(expectedRevision, state.currentRevision)
        }
        return RevisionOutcome.Accepted(newRevision)
    }

    /** Mirrors `RevisionGuard.commit`: only ever called after [evaluate] returned `Accepted`. */
    fun commit(state: RevisionGuardState, operationId: String, newRevision: Int): RevisionGuardState {
        val updatedIds = (state.appliedOperationIds + operationId)
            .let { ids ->
                if (ids.size <= RevisionGuardState.MAX_REMEMBERED_OPERATION_IDS) {
                    ids
                } else {
                    // No ordering info to evict "oldest" fairly with a plain Set; keep the newest
                    // by simply keeping this operationId and dropping to a fresh single-entry set
                    // once the bound is hit -- conservative (a very old, already-applied
                    // operationId might replay as non-duplicate) but never unsafe: a replayed
                    // command still has to pass the ordinary expectedRevision check above, and a
                    // revision that has already been superseded is rejected as stale regardless.
                    setOf(operationId)
                }
            }
        return state.copy(currentRevision = newRevision, appliedOperationIds = updatedIds)
    }
}
