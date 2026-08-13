package org.pca.app.feature.webprotection.ingress

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.pca.app.feature.webprotection.engine.PersistentWebRuleRepository
import org.pca.app.feature.webprotection.policy.WebRule
import org.pca.app.feature.webprotection.policy.WebRuleListType
import org.pca.app.feature.webprotection.policy.WebRuleSource
import org.pca.app.foundation.InMemoryPersistentStateStore

/**
 * doc 32's conformance/test injection path -- proves the full chain
 * (trusted payload -> consumer -> [PersistentWebRuleRepository] -> engine
 * lookup) end-to-end without any production crypto transport, per doc 47's
 * end-to-end conformance scenario.
 */
class WebRulePolicyConsumerTest {

    private fun consumer(): Pair<WebRulePolicyConsumer, PersistentWebRuleRepository> {
        val repository = PersistentWebRuleRepository(InMemoryPersistentStateStore())
        return WebRulePolicyConsumer(repository) to repository
    }

    @Test
    fun `a valid same-family payload is applied and becomes queryable`() {
        val (consumer, repository) = consumer()
        val payload = FamilyWebRulePayload(
            familyId = "family-1",
            revision = 1L,
            rules = listOf(WebRule("example.test", WebRuleListType.DENY, WebRuleSource.PARENT_DENYLIST, "family-1", 0L)),
        )

        val outcome = consumer.apply("family-1", payload)

        assertTrue(outcome is WebRuleIngressOutcome.Applied)
        assertEquals(1, repository.findMatching("family-1", "example.test").size)
    }

    @Test
    fun `a payload claiming a different family is rejected outright`() {
        val (consumer, repository) = consumer()
        val payload = FamilyWebRulePayload(
            familyId = "family-OTHER",
            revision = 1L,
            rules = listOf(WebRule("example.test", WebRuleListType.DENY, WebRuleSource.PARENT_DENYLIST, "family-OTHER", 0L)),
        )

        val outcome = consumer.apply("family-1", payload)

        assertTrue(outcome is WebRuleIngressOutcome.RejectedWrongFamily)
        assertTrue(repository.findMatching("family-1", "example.test").isEmpty())
    }

    @Test
    fun `a stale revision is rejected and the previous LKG rules remain active`() {
        val (consumer, repository) = consumer()
        consumer.apply("family-1", FamilyWebRulePayload("family-1", 5L, listOf(WebRule("example.test", WebRuleListType.DENY, WebRuleSource.PARENT_DENYLIST, "family-1", 0L))))

        val outcome = consumer.apply("family-1", FamilyWebRulePayload("family-1", 3L, emptyList()))

        assertTrue(outcome is WebRuleIngressOutcome.RejectedStaleRevision)
        assertEquals(1, repository.findMatching("family-1", "example.test").size)
    }

    /**
     * Coordinator correction: an [expectedFamilyId] of `""` (the same placeholder
     * `EnrollmentCoordinator.persistSuccess()` currently persists) must never be trusted
     * authority for a family-scoped rule payload, even if the payload itself also claims
     * `familyId = ""` -- defense in depth alongside the identity-provider-level fix.
     */
    @Test
    fun `a blank expectedFamilyId is never trusted authority, even if the payload also claims a blank familyId`() {
        val (consumer, repository) = consumer()
        val payload = FamilyWebRulePayload(
            familyId = "",
            revision = 1L,
            rules = listOf(WebRule("example.test", WebRuleListType.DENY, WebRuleSource.PARENT_DENYLIST, "", 0L)),
        )

        val outcome = consumer.apply("", payload)

        assertTrue(outcome is WebRuleIngressOutcome.RejectedNoTrustedFamilyAuthority)
        assertEquals(null, repository.parentRulesRevision)
        assertTrue(repository.snapshot().isEmpty())
    }

    @Test
    fun `a whitespace-only expectedFamilyId is never trusted authority`() {
        val (consumer, repository) = consumer()
        val payload = FamilyWebRulePayload(familyId = "   ", revision = 1L, rules = emptyList())

        val outcome = consumer.apply("   ", payload)

        assertTrue(outcome is WebRuleIngressOutcome.RejectedNoTrustedFamilyAuthority)
        assertEquals(null, repository.parentRulesRevision)
    }

    @Test
    fun `end-to-end conformance scenario, doc 47 -- deny then explicit replace, never leaking rules to the security feed`() {
        val (consumer, repository) = consumer()
        consumer.apply("family-1", FamilyWebRulePayload("family-1", 1L, listOf(WebRule("example.test", WebRuleListType.DENY, WebRuleSource.PARENT_DENYLIST, "family-1", 0L))))
        assertEquals(1, repository.findMatching("family-1", "example.test").size)

        // (LKG durability across a process restart is covered separately by PersistentWebRuleRepositoryTest.)
        val replaceOutcome = consumer.apply("family-1", FamilyWebRulePayload("family-1", 2L, emptyList()))
        assertTrue(replaceOutcome is WebRuleIngressOutcome.Applied)
        assertTrue(repository.findMatching("family-1", "example.test").isEmpty())
        assertTrue(repository.snapshot().none { it.source == WebRuleSource.SECURITY_DENYLIST })
    }
}
