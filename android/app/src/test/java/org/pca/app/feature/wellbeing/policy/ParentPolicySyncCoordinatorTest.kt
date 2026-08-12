package org.pca.app.feature.wellbeing.policy

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ParentPolicySyncCoordinatorTest {

    private fun policy(revision: Int, enabled: Boolean = true) = ParentWellbeingPolicyV1(
        policyId = "family-1",
        policyRevision = revision,
        familyScopeRef = "family-scope",
        targets = SdkTargetScope(SdkTargetMode.ALL_CHILDREN),
        enabled = enabled,
    )

    @Test
    fun `a newly received policy lands in pending, not active -- old policy keeps applying`() {
        val v1 = policy(revision = 1)
        val afterV1 = ParentPolicySyncCoordinator.promote(
            ParentPolicySyncCoordinator.receive(ParentPolicyStateStore.Snapshot.EMPTY, v1, "op-1").snapshot,
        )
        assertEquals(1, afterV1.syncState.active?.revision)

        val v2 = policy(revision = 2, enabled = false)
        val received = ParentPolicySyncCoordinator.receive(afterV1, v2, "op-2")
        assertTrue(received.outcome is RevisionOutcome.Accepted)

        // Old (v1, enabled=true) policy is still active; v2 sits pending until explicitly promoted.
        assertEquals(1, received.snapshot.syncState.active?.revision)
        assertTrue(received.snapshot.syncState.active?.policy?.enabled == true)
        assertEquals(2, received.snapshot.syncState.pending?.revision)
    }

    @Test
    fun `promote moves pending to active and clears pending`() {
        val v1 = policy(revision = 1)
        val received = ParentPolicySyncCoordinator.receive(ParentPolicyStateStore.Snapshot.EMPTY, v1, "op-1")
        val promoted = ParentPolicySyncCoordinator.promote(received.snapshot)

        assertEquals(1, promoted.syncState.active?.revision)
        assertNull(promoted.syncState.pending)
    }

    @Test
    fun `promote with nothing pending is a no-op`() {
        val v1 = policy(revision = 1)
        val received = ParentPolicySyncCoordinator.promote(
            ParentPolicySyncCoordinator.receive(ParentPolicyStateStore.Snapshot.EMPTY, v1, "op-1").snapshot,
        )
        val promotedAgain = ParentPolicySyncCoordinator.promote(received)
        assertEquals(received, promotedAgain)
    }

    @Test
    fun `stale revision is rejected and does not touch active or pending`() {
        val v1 = policy(revision = 1)
        var snapshot = ParentPolicySyncCoordinator.promote(
            ParentPolicySyncCoordinator.receive(ParentPolicyStateStore.Snapshot.EMPTY, v1, "op-1").snapshot,
        )
        val staleAttempt = policy(revision = 1) // not strictly greater than current revision (1)
        val result = ParentPolicySyncCoordinator.receive(snapshot, staleAttempt, "op-stale")

        assertTrue(result.outcome is RevisionOutcome.StaleRejected)
        assertEquals(snapshot, result.snapshot)
    }

    @Test
    fun `duplicate operationId is a no-op even with a higher revision number`() {
        val v1 = policy(revision = 1)
        val first = ParentPolicySyncCoordinator.receive(ParentPolicyStateStore.Snapshot.EMPTY, v1, "op-dup")
        val replay = ParentPolicySyncCoordinator.receive(first.snapshot, policy(revision = 2), "op-dup")

        assertTrue(replay.outcome is RevisionOutcome.DuplicateNoOp)
        assertEquals(first.snapshot, replay.snapshot)
    }

    @Test
    fun `promoting a policy that arrived while offline never enumerates or replays missed nudges`() {
        // Structural guarantee (item 13): promote() only swaps which ParentWellbeingPolicyV1 is
        // active. It has no NudgeRateState/NudgeSelection parameter or return value at all, so
        // there is no code path here capable of producing a "backlog" of nudges to replay.
        val v1 = policy(revision = 1)
        val afterV1 = ParentPolicySyncCoordinator.promote(
            ParentPolicySyncCoordinator.receive(ParentPolicyStateStore.Snapshot.EMPTY, v1, "op-1").snapshot,
        )
        val received = ParentPolicySyncCoordinator.receive(afterV1, policy(revision = 2), "op-2")
        val promoted = ParentPolicySyncCoordinator.promote(received.snapshot)

        // promote()'s signature/return type is itself the proof: Snapshot -> Snapshot, nothing
        // resembling a nudge/selection list exists to inspect.
        assertEquals(2, promoted.syncState.active?.revision)
    }
}
