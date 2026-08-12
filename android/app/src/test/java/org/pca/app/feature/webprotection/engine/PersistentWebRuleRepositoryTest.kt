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
    fun `corrupt stored state fails safe to an empty rule set, never a fabricated one`() {
        val backing = InMemoryPersistentStateStore()
        backing.putString("webprotection_rules_v1", "{not json")

        val repo = PersistentWebRuleRepository(backing)

        assertTrue(repo.findMatching("family-1", "anything.example").isEmpty())
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
}
