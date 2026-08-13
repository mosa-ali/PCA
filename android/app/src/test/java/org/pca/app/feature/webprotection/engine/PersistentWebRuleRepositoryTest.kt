package org.pca.app.feature.webprotection.engine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.pca.app.feature.webprotection.policy.WebRule
import org.pca.app.feature.webprotection.policy.WebRuleListType
import org.pca.app.feature.webprotection.policy.WebRuleSource
import org.pca.app.foundation.InMemoryPersistentStateStore

class PersistentWebRuleRepositoryTest {

    @Test
    fun `rules survive a fresh repository instance over the same backing store`() {
        val backing = InMemoryPersistentStateStore()
        val first = PersistentWebRuleRepository(backing)
        first.put(WebRule("blocked.example", WebRuleListType.DENY, WebRuleSource.PARENT_DENYLIST, "family-1", 0L))

        val second = PersistentWebRuleRepository(backing)
        val matched = second.findMatching("family-1", "blocked.example")

        assertEquals(1, matched.size)
        assertEquals(WebRuleSource.PARENT_DENYLIST, matched.single().source)
    }

    @Test
    fun `corrupt stored state fails safe to an empty rule set, never a fabricated one, and reports CORRUPT_USING_LKG honestly`() {
        val backing = InMemoryPersistentStateStore()
        backing.putString("webprotection_rules_v1", "{not json")

        val repo = PersistentWebRuleRepository(backing)

        assertTrue(repo.findMatching("family-1", "anything.example").isEmpty())
        assertEquals(WebRulePolicyState.CORRUPT_USING_LKG, repo.state)
    }

    @Test
    fun `removing a rule persists across instances`() {
        val backing = InMemoryPersistentStateStore()
        val first = PersistentWebRuleRepository(backing)
        first.put(WebRule("site.example", WebRuleListType.DENY, WebRuleSource.PARENT_DENYLIST, "family-1", 0L))
        first.remove("family-1", "site.example", WebRuleListType.DENY)

        val second = PersistentWebRuleRepository(backing)
        assertTrue(second.findMatching("family-1", "site.example").isEmpty())
    }

    @Test
    fun `a fresh store with nothing ever written reports NO_POLICY_YET`() {
        val repo = PersistentWebRuleRepository(InMemoryPersistentStateStore())
        assertEquals(WebRulePolicyState.NO_POLICY_YET, repo.state)
        assertEquals(null, repo.parentRulesRevision)
    }

    @Test
    fun `replaceParentRules accepts a valid replacement and becomes the new LKG`() {
        val repo = PersistentWebRuleRepository(InMemoryPersistentStateStore())
        val rules = listOf(WebRule("blocked.example", WebRuleListType.DENY, WebRuleSource.PARENT_DENYLIST, "family-1", 0L))

        val result = repo.replaceParentRules("family-1", rules, revision = 1L)

        assertTrue(result is WebRuleReplaceResult.Applied)
        assertEquals(1L, repo.parentRulesRevision)
        assertEquals(WebRulePolicyState.VALID, repo.state)
        assertEquals(1, repo.findMatching("family-1", "blocked.example").size)
    }

    @Test
    fun `replaceParentRules accepts a legitimate explicit empty rule set as valid, not corrupt`() {
        val repo = PersistentWebRuleRepository(InMemoryPersistentStateStore())
        repo.replaceParentRules("family-1", listOf(WebRule("blocked.example", WebRuleListType.DENY, WebRuleSource.PARENT_DENYLIST, "family-1", 0L)), revision = 1L)

        val result = repo.replaceParentRules("family-1", emptyList(), revision = 2L)

        assertTrue(result is WebRuleReplaceResult.Applied)
        assertEquals(WebRulePolicyState.VALID, repo.state)
        assertTrue(repo.findMatching("family-1", "blocked.example").isEmpty())
    }

    @Test
    fun `replaceParentRules rejects a stale or equal revision and keeps the existing LKG active`() {
        val backing = InMemoryPersistentStateStore()
        val repo = PersistentWebRuleRepository(backing)
        val original = listOf(WebRule("blocked.example", WebRuleListType.DENY, WebRuleSource.PARENT_DENYLIST, "family-1", 0L))
        repo.replaceParentRules("family-1", original, revision = 5L)

        val staleResult = repo.replaceParentRules("family-1", emptyList(), revision = 5L)
        val rollbackResult = repo.replaceParentRules("family-1", emptyList(), revision = 3L)

        assertTrue(staleResult is WebRuleReplaceResult.RejectedStaleRevision)
        assertTrue(rollbackResult is WebRuleReplaceResult.RejectedStaleRevision)
        assertEquals(5L, repo.parentRulesRevision)
        assertEquals(1, repo.findMatching("family-1", "blocked.example").size)
    }

    @Test
    fun `replaceParentRules rejects a malformed domain without mutating the existing LKG`() {
        val repo = PersistentWebRuleRepository(InMemoryPersistentStateStore())
        val original = listOf(WebRule("blocked.example", WebRuleListType.DENY, WebRuleSource.PARENT_DENYLIST, "family-1", 0L))
        repo.replaceParentRules("family-1", original, revision = 1L)

        val malformed = listOf(WebRule("http://not-a-bare-domain.example/path", WebRuleListType.DENY, WebRuleSource.PARENT_DENYLIST, "family-1", 0L))
        val result = repo.replaceParentRules("family-1", malformed, revision = 2L)

        assertTrue(result is WebRuleReplaceResult.RejectedInvalidDomain)
        assertEquals(1L, repo.parentRulesRevision)
        assertEquals(1, repo.findMatching("family-1", "blocked.example").size)
    }

    @Test
    fun `replaceParentRules cannot write a SECURITY_DENYLIST or wrong-family rule`() {
        val repo = PersistentWebRuleRepository(InMemoryPersistentStateStore())
        val forbidden = listOf(WebRule("malware.example", WebRuleListType.DENY, WebRuleSource.SECURITY_DENYLIST, null, 0L))

        val result = repo.replaceParentRules("family-1", forbidden, revision = 1L)

        assertTrue(result is WebRuleReplaceResult.RejectedSourceMismatch)
        assertEquals(null, repo.parentRulesRevision)
    }

    @Test
    fun `replaceParentRules and replaceSecurityFeedRules track independent revision counters and never clobber each other`() {
        val repo = PersistentWebRuleRepository(InMemoryPersistentStateStore())
        repo.replaceParentRules("family-1", listOf(WebRule("parent-blocked.example", WebRuleListType.DENY, WebRuleSource.PARENT_DENYLIST, "family-1", 0L)), revision = 1L)
        repo.replaceSecurityFeedRules(listOf(WebRule("malware.example", WebRuleListType.DENY, WebRuleSource.SECURITY_DENYLIST, null, 0L)), packageVersion = "1.0.0")

        assertEquals(1L, repo.parentRulesRevision)
        assertEquals("1.0.0", repo.securityFeedVersion)
        assertEquals(1, repo.findMatching("family-1", "parent-blocked.example").size)
        assertEquals(1, repo.findMatching("family-1", "malware.example").size)

        val stale = repo.replaceSecurityFeedRules(emptyList(), packageVersion = "0.9.0")
        assertTrue(stale is WebRuleReplaceResult.RejectedStaleRevision)
        assertEquals(1L, repo.parentRulesRevision) // unaffected by the security-feed rejection
        assertEquals(1, repo.findMatching("family-1", "malware.example").size) // LKG preserved
    }

    @Test
    fun `revision and LKG rules survive a fresh repository instance over the same backing store`() {
        val backing = InMemoryPersistentStateStore()
        val first = PersistentWebRuleRepository(backing)
        first.replaceParentRules("family-1", listOf(WebRule("blocked.example", WebRuleListType.DENY, WebRuleSource.PARENT_DENYLIST, "family-1", 0L)), revision = 7L)

        val second = PersistentWebRuleRepository(backing)

        assertEquals(7L, second.parentRulesRevision)
        assertEquals(WebRulePolicyState.VALID, second.state)
        assertEquals(1, second.findMatching("family-1", "blocked.example").size)
    }
}
