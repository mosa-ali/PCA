package org.pca.app.feature.wellbeing.policy

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ParentPolicyRevisionGuardTest {

    @Test
    fun `first-ever policy is accepted`() {
        val outcome = ParentPolicyRevisionGuard.evaluate(RevisionGuardState.INITIAL, "op-1", expectedRevision = 0, newRevision = 1)
        assertEquals(RevisionOutcome.Accepted(1), outcome)
    }

    @Test
    fun `newer-apply is accepted`() {
        val state = RevisionGuardState(currentRevision = 5)
        val outcome = ParentPolicyRevisionGuard.evaluate(state, "op-2", expectedRevision = 5, newRevision = 6)
        assertEquals(RevisionOutcome.Accepted(6), outcome)
    }

    @Test
    fun `stale update is rejected -- expectedRevision mismatch`() {
        val state = RevisionGuardState(currentRevision = 5)
        val outcome = ParentPolicyRevisionGuard.evaluate(state, "op-3", expectedRevision = 4, newRevision = 6)
        assertTrue(outcome is RevisionOutcome.StaleRejected)
    }

    @Test
    fun `stale update is rejected -- newRevision not strictly greater`() {
        val state = RevisionGuardState(currentRevision = 5)
        val outcome = ParentPolicyRevisionGuard.evaluate(state, "op-4", expectedRevision = 5, newRevision = 5)
        assertTrue(outcome is RevisionOutcome.StaleRejected)
    }

    @Test
    fun `duplicate operationId is idempotent no-op regardless of revision`() {
        val state = RevisionGuardState(currentRevision = 5, appliedOperationIds = setOf("op-5"))
        val outcome = ParentPolicyRevisionGuard.evaluate(state, "op-5", expectedRevision = 5, newRevision = 6)
        assertEquals(RevisionOutcome.DuplicateNoOp("op-5"), outcome)
    }

    @Test
    fun `commit advances revision and remembers operationId`() {
        val state = RevisionGuardState(currentRevision = 5)
        val committed = ParentPolicyRevisionGuard.commit(state, "op-6", 6)
        assertEquals(6, committed.currentRevision)
        assertTrue("op-6" in committed.appliedOperationIds)
    }

    @Test
    fun `a replayed duplicate after commit is still a no-op`() {
        var state = RevisionGuardState.INITIAL
        val first = ParentPolicyRevisionGuard.evaluate(state, "op-7", 0, 1) as RevisionOutcome.Accepted
        state = ParentPolicyRevisionGuard.commit(state, "op-7", first.newRevision)

        val replay = ParentPolicyRevisionGuard.evaluate(state, "op-7", expectedRevision = 1, newRevision = 2)
        assertEquals(RevisionOutcome.DuplicateNoOp("op-7"), replay)
    }
}
