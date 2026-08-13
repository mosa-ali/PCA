package org.pca.app.feature.webprotection.safebrowser

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.pca.app.feature.webprotection.policy.WebDecisionOutcome
import org.pca.app.feature.webprotection.policy.WebDecisionSource
import org.pca.app.feature.webprotection.policy.WebReasonId
import org.pca.app.foundation.InMemoryPersistentStateStore

private fun heldDecision(requestable: Boolean = true, id: String = "decision-1"): BlockDecisionState = BlockDecisionState(
    id = id,
    familyId = "family-1",
    profileId = "profile-1",
    domain = "blocked.example",
    url = "https://blocked.example/page",
    pageTitle = "Blocked",
    outcome = WebDecisionOutcome.BLOCK,
    source = WebDecisionSource.PARENT_DENYLIST,
    reasonId = WebReasonId.PARENT_DENYLIST,
    reasonCode = "Blocked by a parent rule",
    requestable = requestable,
    createdAtEpochMillis = 0L,
)

class ParentUnblockRequestServiceTest {

    private fun service() = ParentUnblockRequestService(PersistentParentUnblockRequestRepository(InMemoryPersistentStateStore()))

    @Test
    fun `submitting a requestable decision creates a PENDING request, never self-approved`() {
        val request = service().submit(heldDecision())

        assertEquals(ParentUnblockRequestStatus.PENDING, request.status)
        assertEquals("blocked.example", request.domain)
    }

    @Test
    fun `a non-overridable security decision cannot be submitted at all -- doc 27's non-requestable rule`() {
        try {
            service().submit(heldDecision(requestable = false))
            assertTrue("expected DecisionNotRequestable", false)
        } catch (_: UnblockRequestError.DecisionNotRequestable) {
            // expected
        }
    }

    @Test
    fun `a duplicate submission for the same decision is rejected as already pending`() {
        val svc = service()
        svc.submit(heldDecision())

        try {
            svc.submit(heldDecision())
            assertTrue("expected AlreadyPending", false)
        } catch (_: UnblockRequestError.AlreadyPending) {
            // expected
        }
    }

    @Test
    fun `approveTemporary transitions to APPROVED_TEMPORARY with a real expiry, never a self-approval path`() {
        val svc = service()
        val request = svc.submit(heldDecision())

        val approved = svc.approveTemporary(request.id, durationMs = 60_000L)

        assertEquals(ParentUnblockRequestStatus.APPROVED_TEMPORARY, approved.status)
        assertTrue(approved.temporaryApprovalExpiresAtEpochMillis!! > 0L)
    }

    @Test
    fun `a decided request cannot be decided again -- illegal transition`() {
        val svc = service()
        val request = svc.submit(heldDecision())
        svc.deny(request.id)

        try {
            svc.approvePermanent(request.id)
            assertTrue("expected IllegalTransition", false)
        } catch (_: UnblockRequestError.IllegalTransition) {
            // expected
        }
    }

    @Test
    fun `requests survive a fresh service instance over the same backing store`() {
        val backing = InMemoryPersistentStateStore()
        val first = ParentUnblockRequestService(PersistentParentUnblockRequestRepository(backing))
        val request = first.submit(heldDecision())

        val secondRepo = PersistentParentUnblockRequestRepository(backing)
        assertEquals(ParentUnblockRequestStatus.PENDING, secondRepo.get(request.id)?.status)
    }
}
