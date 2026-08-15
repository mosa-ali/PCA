package org.pca.app.feature.removaldecision

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Test

class RemovalDecisionStateMachineTest {
    private val machine = RemovalDecisionStateMachine()
    private val t0 = 1_000_000L

    @Test
    fun `initial record is KEEP_ACTIVE`() {
        val record = RemovalDecisionRecord.initial(t0)
        assertEquals(RemovalDecisionState.KEEP_ACTIVE, record.state)
    }

    @Test
    fun `requestReview from KEEP_ACTIVE moves to PARENT_APPROVAL_REQUIRED`() {
        val record = RemovalDecisionRecord.initial(t0)
        val next = machine.requestReview(record, t0 + 1)
        assertEquals(RemovalDecisionState.PARENT_APPROVAL_REQUIRED, next.state)
    }

    @Test
    fun `requestReview while already pending is rejected`() {
        val pending = RemovalDecisionRecord(RemovalDecisionState.PARENT_APPROVAL_REQUIRED, t0)
        assertThrows(InvalidRemovalDecisionTransitionException::class.java) {
            machine.requestReview(pending, t0 + 1)
        }
    }

    @Test
    fun `requestReview from ALLOW_REMOVAL is rejected -- terminal state`() {
        val allowed = RemovalDecisionRecord(RemovalDecisionState.ALLOW_REMOVAL, t0)
        assertThrows(InvalidRemovalDecisionTransitionException::class.java) {
            machine.requestReview(allowed, t0 + 1)
        }
    }

    @Test
    fun `requestReview from an active (not yet expired) TEMPORARILY_DISABLE window is rejected`() {
        val disabled = RemovalDecisionRecord(RemovalDecisionState.TEMPORARILY_DISABLE, t0, temporarilyDisabledUntilEpochMillis = t0 + 10_000)
        assertThrows(InvalidRemovalDecisionTransitionException::class.java) {
            machine.requestReview(disabled, t0 + 5_000) // still before the deadline
        }
    }

    @Test
    fun `requestReview from an expired TEMPORARILY_DISABLE window succeeds`() {
        val disabled = RemovalDecisionRecord(RemovalDecisionState.TEMPORARILY_DISABLE, t0, temporarilyDisabledUntilEpochMillis = t0 + 10_000)
        val next = machine.requestReview(disabled, t0 + 10_001)
        assertEquals(RemovalDecisionState.PARENT_APPROVAL_REQUIRED, next.state)
    }

    @Test
    fun `decideKeepActive from PARENT_APPROVAL_REQUIRED succeeds`() {
        val pending = RemovalDecisionRecord(RemovalDecisionState.PARENT_APPROVAL_REQUIRED, t0)
        val next = machine.decideKeepActive(pending, t0 + 1)
        assertEquals(RemovalDecisionState.KEEP_ACTIVE, next.state)
    }

    @Test
    fun `decideKeepActive from KEEP_ACTIVE (no pending request) is rejected`() {
        val active = RemovalDecisionRecord.initial(t0)
        assertThrows(InvalidRemovalDecisionTransitionException::class.java) {
            machine.decideKeepActive(active, t0 + 1)
        }
    }

    @Test
    fun `decideAllowRemoval from KEEP_ACTIVE, skipping the approval step, is rejected`() {
        val active = RemovalDecisionRecord.initial(t0)
        assertThrows(InvalidRemovalDecisionTransitionException::class.java) {
            machine.decideAllowRemoval(active, t0 + 1)
        }
    }

    @Test
    fun `decideAllowRemoval from an active TEMPORARILY_DISABLE window, skipping approval, is rejected`() {
        val disabled = RemovalDecisionRecord(RemovalDecisionState.TEMPORARILY_DISABLE, t0, temporarilyDisabledUntilEpochMillis = t0 + 10_000)
        assertThrows(InvalidRemovalDecisionTransitionException::class.java) {
            machine.decideAllowRemoval(disabled, t0 + 1)
        }
    }

    @Test
    fun `decideAllowRemoval from PARENT_APPROVAL_REQUIRED succeeds and is terminal`() {
        val pending = RemovalDecisionRecord(RemovalDecisionState.PARENT_APPROVAL_REQUIRED, t0)
        val next = machine.decideAllowRemoval(pending, t0 + 1)
        assertEquals(RemovalDecisionState.ALLOW_REMOVAL, next.state)
        assertThrows(InvalidRemovalDecisionTransitionException::class.java) {
            machine.requestReview(next, t0 + 2)
        }
    }

    @Test
    fun `decideTemporarilyDisable from PARENT_APPROVAL_REQUIRED succeeds and records the deadline`() {
        val pending = RemovalDecisionRecord(RemovalDecisionState.PARENT_APPROVAL_REQUIRED, t0)
        val next = machine.decideTemporarilyDisable(pending, t0 + 1, t0 + 3_600_000)
        assertEquals(RemovalDecisionState.TEMPORARILY_DISABLE, next.state)
        assertEquals(t0 + 3_600_000, next.temporarilyDisabledUntilEpochMillis)
    }

    @Test
    fun `decideTemporarilyDisable rejects a non-future deadline`() {
        val pending = RemovalDecisionRecord(RemovalDecisionState.PARENT_APPROVAL_REQUIRED, t0)
        assertThrows(IllegalArgumentException::class.java) {
            machine.decideTemporarilyDisable(pending, t0 + 100, t0 + 100)
        }
    }

    @Test
    fun `decideTemporarilyDisable from KEEP_ACTIVE, skipping approval, is rejected`() {
        val active = RemovalDecisionRecord.initial(t0)
        assertThrows(InvalidRemovalDecisionTransitionException::class.java) {
            machine.decideTemporarilyDisable(active, t0 + 1, t0 + 10_000)
        }
    }

    @Test
    fun `resolveExpiry is a no-op before the deadline`() {
        val disabled = RemovalDecisionRecord(RemovalDecisionState.TEMPORARILY_DISABLE, t0, temporarilyDisabledUntilEpochMillis = t0 + 10_000)
        val resolved = machine.resolveExpiry(disabled, t0 + 5_000)
        assertEquals(RemovalDecisionState.TEMPORARILY_DISABLE, resolved.state)
    }

    @Test
    fun `resolveExpiry reverts to KEEP_ACTIVE once the deadline has passed`() {
        val disabled = RemovalDecisionRecord(RemovalDecisionState.TEMPORARILY_DISABLE, t0, temporarilyDisabledUntilEpochMillis = t0 + 10_000)
        val resolved = machine.resolveExpiry(disabled, t0 + 10_001)
        assertEquals(RemovalDecisionState.KEEP_ACTIVE, resolved.state)
        assertNull(resolved.temporarilyDisabledUntilEpochMillis)
    }

    @Test
    fun `resolveExpiry is a no-op for every other state`() {
        val active = RemovalDecisionRecord.initial(t0)
        assertEquals(active, machine.resolveExpiry(active, t0 + 999_999))
        val pending = RemovalDecisionRecord(RemovalDecisionState.PARENT_APPROVAL_REQUIRED, t0)
        assertEquals(pending, machine.resolveExpiry(pending, t0 + 999_999))
        val allowed = RemovalDecisionRecord(RemovalDecisionState.ALLOW_REMOVAL, t0)
        assertEquals(allowed, machine.resolveExpiry(allowed, t0 + 999_999))
    }

    @Test
    fun `record construction rejects a TEMPORARILY_DISABLE state with no deadline`() {
        assertThrows(IllegalArgumentException::class.java) {
            RemovalDecisionRecord(RemovalDecisionState.TEMPORARILY_DISABLE, t0, temporarilyDisabledUntilEpochMillis = null)
        }
    }

    @Test
    fun `record construction rejects a non-TEMPORARILY_DISABLE state carrying a deadline`() {
        assertThrows(IllegalArgumentException::class.java) {
            RemovalDecisionRecord(RemovalDecisionState.KEEP_ACTIVE, t0, temporarilyDisabledUntilEpochMillis = t0 + 1)
        }
    }
}
