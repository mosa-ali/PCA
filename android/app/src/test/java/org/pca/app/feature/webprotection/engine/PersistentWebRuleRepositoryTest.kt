package org.pca.app.feature.webprotection.engine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import org.pca.app.feature.webprotection.policy.WebRule
import org.pca.app.feature.webprotection.policy.WebRuleListType
import org.pca.app.feature.webprotection.policy.WebRuleSource
import org.pca.app.foundation.InMemoryPersistentStateStore
import org.pca.app.foundation.PersistentStateStore
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.ConcurrentLinkedQueue

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

    @Test
    fun `failed put and remove keep the live LKG and durable snapshot unchanged`() {
        val backing = InMemoryPersistentStateStore()
        val seed = PersistentWebRuleRepository(backing)
        val original = WebRule("blocked.example", WebRuleListType.DENY, WebRuleSource.PARENT_DENYLIST, "family-1", 0L)
        seed.replaceParentRules("family-1", listOf(original), revision = 4L)

        val failing = FailingPersistentStateStore(backing)
        val repo = PersistentWebRuleRepository(failing)
        failing.failNextPutAfterApply = true
        assertMutationFailure {
            repo.put(WebRule("new.example", WebRuleListType.DENY, WebRuleSource.PARENT_DENYLIST, "family-1", 0L))
        }

        assertEquals(WebRulePolicyState.VALID, repo.state)
        assertEquals(4L, repo.parentRulesRevision)
        assertEquals(listOf(original), repo.snapshot())
        assertReopenedSnapshot(backing, listOf(original), 4L, null)

        failing.failNextPutBeforeApply = true
        assertMutationFailure { repo.remove("family-1", "blocked.example", WebRuleListType.DENY) }

        assertEquals(WebRulePolicyState.VALID, repo.state)
        assertEquals(4L, repo.parentRulesRevision)
        assertEquals(listOf(original), repo.snapshot())
        assertReopenedSnapshot(backing, listOf(original), 4L, null)
    }

    @Test
    fun `failed whole-scope replacements keep parent and security-feed revisions and rules`() {
        val backing = InMemoryPersistentStateStore()
        val seed = PersistentWebRuleRepository(backing)
        val parent = WebRule("parent.example", WebRuleListType.DENY, WebRuleSource.PARENT_DENYLIST, "family-1", 0L)
        val feed = WebRule("malware.example", WebRuleListType.DENY, WebRuleSource.SECURITY_DENYLIST, null, 0L)
        seed.replaceParentRules("family-1", listOf(parent), revision = 4L)
        seed.replaceSecurityFeedRules(listOf(feed), packageVersion = "1.2.0")

        val failing = FailingPersistentStateStore(backing)
        val repo = PersistentWebRuleRepository(failing)
        failing.failNextFlush = true
        assertMutationFailure {
            repo.replaceParentRules(
                "family-1",
                listOf(WebRule("replacement.example", WebRuleListType.DENY, WebRuleSource.PARENT_DENYLIST, "family-1", 0L)),
                revision = 5L,
            )
        }

        assertEquals(4L, repo.parentRulesRevision)
        assertEquals("1.2.0", repo.securityFeedVersion)
        assertEquals(listOf(parent, feed), repo.snapshot())
        assertReopenedSnapshot(backing, listOf(parent, feed), 4L, "1.2.0")

        failing.failNextPutAfterApply = true
        assertMutationFailure {
            repo.replaceSecurityFeedRules(
                listOf(WebRule("new-malware.example", WebRuleListType.DENY, WebRuleSource.SECURITY_DENYLIST, null, 0L)),
                packageVersion = "1.3.0",
            )
        }

        assertEquals(4L, repo.parentRulesRevision)
        assertEquals("1.2.0", repo.securityFeedVersion)
        assertEquals(listOf(parent, feed), repo.snapshot())
        assertReopenedSnapshot(backing, listOf(parent, feed), 4L, "1.2.0")
    }

    @Test
    fun `concurrent repository wrappers serialize updates and refresh the durable base`() {
        val backing = InMemoryPersistentStateStore()
        val first = PersistentWebRuleRepository(backing)
        val second = PersistentWebRuleRepository(backing)
        val ready = CountDownLatch(2)
        val start = CountDownLatch(1)
        val errors = ConcurrentLinkedQueue<Throwable>()
        val firstRule = WebRule("first.example", WebRuleListType.DENY, WebRuleSource.PARENT_DENYLIST, "family-1", 0L)
        val secondRule = WebRule("second.example", WebRuleListType.DENY, WebRuleSource.PARENT_DENYLIST, "family-1", 0L)

        val writers = listOf(first to firstRule, second to secondRule).map { (repo, rule) ->
            Thread {
                ready.countDown()
                try {
                    check(start.await(5, TimeUnit.SECONDS))
                    repo.put(rule)
                } catch (failure: Throwable) {
                    errors.add(failure)
                }
            }.apply { start() }
        }

        assertTrue("writers did not reach the barrier", ready.await(5, TimeUnit.SECONDS))
        start.countDown()
        writers.forEach { it.join(5_000) }
        assertTrue("writer thread remained active", writers.none { it.isAlive })
        assertTrue("concurrent mutation failed: $errors", errors.isEmpty())

        val reopened = PersistentWebRuleRepository(backing)
        assertEquals(setOf(firstRule, secondRule), reopened.snapshot().toSet())
    }

    @Test
    fun `existing wrappers refresh rules revision version and state without mutation`() {
        val backing = InMemoryPersistentStateStore()
        val reader = PersistentWebRuleRepository(backing)
        val writer = PersistentWebRuleRepository(backing)
        val parent = WebRule("parent.example", WebRuleListType.DENY, WebRuleSource.PARENT_DENYLIST, "family-1", 0L)
        val feed = WebRule("malware.example", WebRuleListType.DENY, WebRuleSource.SECURITY_DENYLIST, null, 0L)
        writer.replaceParentRules("family-1", listOf(parent), 4L)
        writer.replaceSecurityFeedRules(listOf(feed), "1.2.0")
        assertEquals(WebRulePolicyState.VALID, reader.state)
        assertEquals(4L, reader.parentRulesRevision)
        assertEquals("1.2.0", reader.securityFeedVersion)
        assertEquals(listOf(parent), reader.findMatching("family-1", "parent.example"))
        assertEquals(listOf(parent, feed), reader.snapshot())
        backing.putString("webprotection_rules_v1", "{broken")
        assertEquals(WebRulePolicyState.CORRUPT_USING_LKG, reader.state)
        assertEquals(listOf(parent, feed), reader.snapshot())
        assertEquals(4L, reader.parentRulesRevision)
        assertEquals("1.2.0", reader.securityFeedVersion)
    }

    @Test
    fun `invalid persisted rule semantics retain the live LKG`() {
        val mutations = listOf<(org.json.JSONObject) -> Unit>(
            { it.put("familyId", org.json.JSONObject.NULL) },
            { it.put("familyId", " ") },
            { it.put("familyId", 42) },
            { it.put("listType", "ALLOW") },
            { it.put("source", "SECURITY_DENYLIST") },
            { it.put("source", "CATEGORY_RULE") },
            { it.put("domain", "https://blocked.example/path") },
            { it.put("domain", "BLOCKED.example") },
        )
        for (mutate in mutations) {
            val backing = InMemoryPersistentStateStore()
            val repo = PersistentWebRuleRepository(backing)
            val original = WebRule("blocked.example", WebRuleListType.DENY, WebRuleSource.PARENT_DENYLIST, "family-1", 0L)
            repo.replaceParentRules("family-1", listOf(original), 4L)
            val envelope = org.json.JSONObject(backing.getString("webprotection_rules_v1")!!)
            mutate(envelope.getJSONArray("rules").getJSONObject(0))
            backing.putString("webprotection_rules_v1", envelope.toString())
            assertEquals(WebRulePolicyState.CORRUPT_USING_LKG, repo.state)
            assertEquals(listOf(original), repo.snapshot())
            assertEquals(4L, repo.parentRulesRevision)
            assertMutationFailure { repo.remove("family-1", "blocked.example", WebRuleListType.DENY) }
        }
    }

    @Test
    fun `persisted security feed cannot become an allow or family scoped rule`() {
        for (field in listOf("listType", "familyId")) {
            val backing = InMemoryPersistentStateStore()
            val repo = PersistentWebRuleRepository(backing)
            val feed = WebRule("malware.example", WebRuleListType.DENY, WebRuleSource.SECURITY_DENYLIST, null, 0L)
            repo.replaceSecurityFeedRules(listOf(feed), "1.0.0")
            val envelope = org.json.JSONObject(backing.getString("webprotection_rules_v1")!!)
            envelope.getJSONArray("rules").getJSONObject(0).put(field, if (field == "listType") "ALLOW" else "family-1")
            backing.putString("webprotection_rules_v1", envelope.toString())
            assertEquals(WebRulePolicyState.CORRUPT_USING_LKG, repo.state)
            assertEquals(listOf(feed), repo.snapshot())
            assertEquals("1.0.0", repo.securityFeedVersion)
        }
    }

    @Test
    fun `rollback failure poisons every wrapper and preserves each live LKG`() {
        val backing = InMemoryPersistentStateStore()
        val first = PersistentWebRuleRepository(backing)
        val original = WebRule("blocked.example", WebRuleListType.DENY, WebRuleSource.PARENT_DENYLIST, "family-1", 0L)
        first.replaceParentRules("family-1", listOf(original), 4L)
        val failing = FailingPersistentStateStore(backing)
        val second = PersistentWebRuleRepository(failing)
        failing.successfulFlushesBeforeFailure = 1
        failing.failingFlushes = 2
        assertMutationFailure { second.replaceParentRules("family-1", emptyList(), 5L) }
        for (repo in listOf(first, second, PersistentWebRuleRepository(backing))) {
            assertEquals(WebRulePolicyState.CORRUPT_USING_LKG, repo.state)
            assertMutationFailure { repo.put(original) }
            assertMutationFailure { repo.remove("family-1", "blocked.example", WebRuleListType.DENY) }
            assertMutationFailure { repo.replaceParentRules("family-1", emptyList(), 6L) }
            assertMutationFailure { repo.replaceSecurityFeedRules(emptyList(), "2.0.0") }
        }
        assertEquals(listOf(original), first.snapshot())
        assertEquals(listOf(original), second.snapshot())
        assertEquals(4L, first.parentRulesRevision)
        assertEquals(4L, second.parentRulesRevision)
    }

    @Test
    fun `invalid direct puts never mutate the durable or live policy`() {
        val backing = InMemoryPersistentStateStore()
        val repo = PersistentWebRuleRepository(backing)
        val original = WebRule("blocked.example", WebRuleListType.DENY, WebRuleSource.PARENT_DENYLIST, "family-1", 0L)
        repo.replaceParentRules("family-1", listOf(original), 4L)
        val durable = backing.getString("webprotection_rules_v1")
        val invalid = listOf(
            original.copy(familyId = null),
            original.copy(familyId = " "),
            original.copy(listType = WebRuleListType.ALLOW),
            original.copy(domain = "BLOCKED.example"),
            original.copy(source = WebRuleSource.CATEGORY_RULE),
            original.copy(source = WebRuleSource.SECURITY_DENYLIST),
            original.copy(source = WebRuleSource.SECURITY_DENYLIST, familyId = null, listType = WebRuleListType.ALLOW),
        )
        for (rule in invalid) {
            try {
                repo.put(rule)
                fail("invalid direct put must fail")
            } catch (_: IllegalArgumentException) { }
            assertEquals(durable, backing.getString("webprotection_rules_v1"))
            assertEquals(listOf(original), repo.snapshot())
            assertEquals(4L, repo.parentRulesRevision)
            assertEquals(WebRulePolicyState.VALID, repo.state)
        }
        assertReopenedSnapshot(backing, listOf(original), 4L, null)
    }

    @Test
    fun `security feed replacement rejects allow rules without mutating LKG`() {
        val backing = InMemoryPersistentStateStore()
        val repo = PersistentWebRuleRepository(backing)
        val original = WebRule("malware.example", WebRuleListType.DENY, WebRuleSource.SECURITY_DENYLIST, null, 0L)
        repo.replaceSecurityFeedRules(listOf(original), "1.0.0")
        val durable = backing.getString("webprotection_rules_v1")
        assertEquals(WebRuleReplaceResult.RejectedSourceMismatch,
            repo.replaceSecurityFeedRules(listOf(original.copy(listType = WebRuleListType.ALLOW)), "2.0.0"))
        assertEquals(durable, backing.getString("webprotection_rules_v1"))
        assertEquals(listOf(original), repo.snapshot())
        assertEquals("1.0.0", repo.securityFeedVersion)
        assertEquals(WebRulePolicyState.VALID, repo.state)
    }

    @Test
    fun `marker is durable before candidate write and absent after success`() {
        val backing = RestartableStore()
        val repo = PersistentWebRuleRepository(backing)
        repo.replaceParentRules("family-1", listOf(parentRule()), 1L)
        assertTrue(backing.candidateWritesAllMarked)
        assertEquals(null, backing.disk[MARKER_KEY])
        assertEquals(listOf(parentRule()), PersistentWebRuleRepository(RestartableStore(backing.disk)).snapshot())
    }

    @Test
    fun `marker write and readback failures never write a candidate`() {
        for (failWrite in listOf(true, false)) {
            val backing = RestartableStore()
            val repo = PersistentWebRuleRepository(backing)
            if (failWrite) backing.failMarkerPut = true else backing.mismatchAtFlush = 1
            assertMutationFailure { repo.replaceParentRules("family-1", listOf(parentRule()), 1L) }
            assertEquals(0, backing.candidateWrites)
            assertEquals(WebRulePolicyState.NO_POLICY_YET, PersistentWebRuleRepository(RestartableStore(backing.disk)).state)
        }
    }

    @Test
    fun `candidate readback mismatch rolls back before removing marker`() {
        val backing = RestartableStore()
        val repo = PersistentWebRuleRepository(backing)
        repo.replaceParentRules("family-1", listOf(parentRule()), 1L)
        backing.resetFaultCounter()
        backing.mismatchAtFlush = 2
        assertMutationFailure { repo.replaceParentRules("family-1", emptyList(), 2L) }
        val restarted = PersistentWebRuleRepository(RestartableStore(backing.disk))
        assertEquals(WebRulePolicyState.VALID, restarted.state)
        assertEquals(listOf(parentRule()), restarted.snapshot())
        assertEquals(1L, restarted.parentRulesRevision)
    }

    @Test
    fun `failed rollback survives process restart as read only even with valid candidate bytes`() {
        val backing = RestartableStore()
        val repo = PersistentWebRuleRepository(backing)
        repo.replaceParentRules("family-1", listOf(parentRule()), 1L)
        backing.resetFaultCounter()
        backing.throwAfterFlushAt = setOf(2)
        backing.failFlushAt = setOf(3)
        assertMutationFailure { repo.replaceParentRules("family-1", emptyList(), 2L) }
        // Fresh lock identity models process death, removing in-process poison.
        val restarted = PersistentWebRuleRepository(RestartableStore(backing.disk))
        assertEquals(WebRulePolicyState.CORRUPT_USING_LKG, restarted.state)
        assertTrue(restarted.snapshot().isEmpty())
        assertMutationFailure { restarted.put(parentRule()) }
        assertMutationFailure { restarted.replaceSecurityFeedRules(emptyList(), "1.0.0") }
        assertEquals(listOf(parentRule()), repo.snapshot())
    }

    @Test
    fun `marker removal failure never rolls back verified candidate bytes`() {
        for (removedDurably in listOf(true, false)) {
            val backing = RestartableStore()
            val repo = PersistentWebRuleRepository(backing)
            repo.replaceParentRules("family-1", listOf(parentRule()), 1L)
            backing.resetFaultCounter()
            if (removedDurably) backing.throwAfterFlushAt = setOf(3)
            else backing.failMarkerRemove = true
            assertMutationFailure { repo.replaceParentRules("family-1", emptyList(), 2L) }
            assertEquals(WebRulePolicyState.CORRUPT_USING_LKG, repo.state)
            assertEquals(listOf(parentRule()), repo.snapshot())
            assertEquals(1, backing.candidateWrites)
            val restarted = PersistentWebRuleRepository(RestartableStore(backing.disk))
            if (removedDurably) {
                assertEquals(WebRulePolicyState.VALID, restarted.state)
                assertEquals(2L, restarted.parentRulesRevision)
                assertTrue(restarted.snapshot().isEmpty())
            } else {
                assertEquals(WebRulePolicyState.CORRUPT_USING_LKG, restarted.state)
                assertMutationFailure { restarted.put(parentRule()) }
            }
        }
    }

    private fun parentRule() = WebRule("blocked.example", WebRuleListType.DENY, WebRuleSource.PARENT_DENYLIST, "family-1", 0L)

    private class RestartableStore(initial: Map<String, String> = emptyMap()) : PersistentStateStore {
        private val memory = initial.toMutableMap()
        var disk = initial.toMap()
        var flushCount = 0
        var candidateWrites = 0
        var candidateWritesAllMarked = true
        var failMarkerPut = false
        var failMarkerRemove = false
        var mismatchAtFlush = -1
        var failFlushAt = emptySet<Int>()
        var throwAfterFlushAt = emptySet<Int>()
        override fun getString(key: String): String? =
            if (flushCount == mismatchAtFlush) "mismatched" else memory[key]
        override fun putString(key: String, value: String) {
            if (key == MARKER_KEY && failMarkerPut) error("marker write failed")
            if (key == RULE_KEY) {
                candidateWrites++
                candidateWritesAllMarked = candidateWritesAllMarked && disk[MARKER_KEY] == "pending"
            }
            memory[key] = value
        }
        override fun remove(key: String) {
            if (key == MARKER_KEY && failMarkerRemove) error("marker removal failed")
            memory.remove(key)
        }
        override fun contains(key: String) = memory.containsKey(key)
        override fun clear() { memory.clear() }
        override fun flush() {
            flushCount++
            if (flushCount in failFlushAt) error("disk write failed")
            disk = memory.toMap()
            if (flushCount in throwAfterFlushAt) error("disk confirmation failed")
        }
        fun resetFaultCounter() { flushCount = 0; candidateWrites = 0 }
    }

    private companion object {
        const val RULE_KEY = "webprotection_rules_v1"
        const val MARKER_KEY = RULE_KEY + "_pending_write"
    }

    @Test
    fun `parent replacements reject blank scope and negative revision without writes`() {
        val backing = InMemoryPersistentStateStore()
        val repo = PersistentWebRuleRepository(backing)
        assertEquals(WebRuleReplaceResult.RejectedSourceMismatch,
            repo.replaceParentRules(" ", listOf(parentRule().copy(familyId = " ")), 0L))
        assertEquals(WebRuleReplaceResult.RejectedSourceMismatch,
            repo.replaceParentRules("", emptyList(), 0L))
        try {
            repo.replaceParentRules("family-1", listOf(parentRule()), -1L)
            fail("negative revision must fail")
        } catch (_: IllegalArgumentException) { }
        assertEquals(null, backing.getString(RULE_KEY))
        assertEquals(null, backing.getString(MARKER_KEY))
        assertEquals(WebRulePolicyState.NO_POLICY_YET, repo.state)
        assertEquals(WebRuleReplaceResult.Applied(1), repo.replaceParentRules("family-1", listOf(parentRule()), 0L))
        assertEquals(0L, repo.parentRulesRevision)
    }

    @Test
    fun `malformed persisted revision cannot lower the parent monotonic floor`() {
        for (invalidRevision in listOf<Any>(-1, "0", 1.5)) {
            val backing = InMemoryPersistentStateStore()
            val repo = PersistentWebRuleRepository(backing)
            val accepted = parentRule()
            assertEquals(WebRuleReplaceResult.Applied(1),
                repo.replaceParentRules("family-1", listOf(accepted), 7L))
            val envelope = org.json.JSONObject(backing.getString(RULE_KEY)!!)
            envelope.put("parentRulesRevision", invalidRevision)
            backing.putString(RULE_KEY, envelope.toString())

            assertEquals(WebRulePolicyState.CORRUPT_USING_LKG, repo.state)
            assertEquals(7L, repo.parentRulesRevision)
            assertEquals(listOf(accepted), repo.snapshot())
            assertEquals(WebRulePolicyState.CORRUPT_USING_LKG,
                PersistentWebRuleRepository(backing).state)
        }
    }

    @Test
    fun `malformed persisted security version cannot change rollback floor`() {
        for (invalidVersion in listOf<Any>(1, org.json.JSONObject().put("version", "2"), "", "x".repeat(33))) {
            val backing = InMemoryPersistentStateStore()
            val repo = PersistentWebRuleRepository(backing)
            val accepted = parentRule().copy(source = WebRuleSource.SECURITY_DENYLIST, familyId = null)
            assertEquals(WebRuleReplaceResult.Applied(1),
                repo.replaceSecurityFeedRules(listOf(accepted), "1.0.0"))
            val envelope = org.json.JSONObject(backing.getString(RULE_KEY)!!)
            envelope.put("securityFeedVersion", invalidVersion)
            backing.putString(RULE_KEY, envelope.toString())

            assertEquals(WebRulePolicyState.CORRUPT_USING_LKG, repo.state)
            assertEquals("1.0.0", repo.securityFeedVersion)
            assertEquals(listOf(accepted), repo.snapshot())
            assertEquals(WebRulePolicyState.CORRUPT_USING_LKG,
                PersistentWebRuleRepository(backing).state)
        }
    }

    @Test
    fun `direct security replacement rejects invalid version before writes`() {
        val backing = InMemoryPersistentStateStore()
        val repo = PersistentWebRuleRepository(backing)
        for (version in listOf("", "x".repeat(33))) {
            try {
                repo.replaceSecurityFeedRules(emptyList(), version)
                fail("invalid version must fail")
            } catch (_: IllegalArgumentException) { }
        }
        assertEquals(null, backing.getString(RULE_KEY))
        assertEquals(WebRulePolicyState.NO_POLICY_YET, repo.state)
    }

    @Test
    fun `large dotted version components compare without overflow and preserve rollback floor`() {
        assertTrue(comparePackageVersions("2147483647.0.0", "0.0.0") > 0)
        assertTrue(comparePackageVersions("0.0.0", "2147483647.0.0") < 0)
        assertTrue(comparePackageVersions("9007199254740991.0.0", "9007199254740990.0.0") > 0)

        val backing = InMemoryPersistentStateStore()
        val repo = PersistentWebRuleRepository(backing)
        val accepted = parentRule().copy(source = WebRuleSource.SECURITY_DENYLIST, familyId = null)
        assertEquals(WebRuleReplaceResult.Applied(1),
            repo.replaceSecurityFeedRules(listOf(accepted), "9007199254740991.0.0"))
        assertEquals(WebRuleReplaceResult.RejectedStaleRevision("9007199254740991.0.0"),
            repo.replaceSecurityFeedRules(emptyList(), "2147483647.0.0"))
        assertEquals("9007199254740991.0.0", repo.securityFeedVersion)
        assertEquals(listOf(accepted), repo.snapshot())
    }

    @Test
    fun `replacement freezes caller list before waiting for shared persistence lock`() {
        for (securityFeed in listOf(false, true)) {
            val backing = InMemoryPersistentStateStore()
            val repo = PersistentWebRuleRepository(backing)
            val original = if (securityFeed) parentRule().copy(source = WebRuleSource.SECURITY_DENYLIST, familyId = null)
                else parentRule()
            val copied = CountDownLatch(1)
            val input = object : AbstractList<WebRule>() {
                var current = original
                override val size: Int get() = 1
                override fun get(index: Int): WebRule { copied.countDown(); return current }
            }
            val errors = ConcurrentLinkedQueue<Throwable>()
            val worker: Thread
            synchronized(backing.coordinationLock) {
                worker = Thread {
                    try {
                        if (securityFeed) repo.replaceSecurityFeedRules(input, "1.0.0")
                        else repo.replaceParentRules("family-1", input, 0L)
                    } catch (failure: Throwable) { errors.add(failure) }
                }
                worker.start()
                assertTrue(copied.await(5, TimeUnit.SECONDS))
                // Wait until the worker is blocked entering persistence, after snapshot validation.
                val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5)
                while (worker.state != Thread.State.BLOCKED && System.nanoTime() < deadline) Thread.yield()
                assertEquals(Thread.State.BLOCKED, worker.state)
                input.current = original.copy(listType = WebRuleListType.ALLOW, source = WebRuleSource.SECURITY_DENYLIST)
            }
            worker.join(5_000)
            assertTrue(!worker.isAlive)
            assertTrue(errors.isEmpty())
            assertEquals(listOf(original), repo.snapshot())
            assertEquals(WebRulePolicyState.VALID, repo.state)
        }
    }

    private fun assertMutationFailure(mutation: () -> Unit) {
        try {
            mutation()
            fail("expected persistent write to fail")
        } catch (_: IllegalStateException) {
            // Expected; assertions below prove that rollback preserved the LKG.
        }
    }

    private fun assertReopenedSnapshot(
        backing: InMemoryPersistentStateStore,
        expectedRules: List<WebRule>,
        expectedParentRevision: Long?,
        expectedFeedVersion: String?,
    ) {
        val reopened = PersistentWebRuleRepository(backing)
        assertEquals(expectedRules, reopened.snapshot())
        assertEquals(expectedParentRevision, reopened.parentRulesRevision)
        assertEquals(expectedFeedVersion, reopened.securityFeedVersion)
        assertEquals(WebRulePolicyState.VALID, reopened.state)
    }

    private class FailingPersistentStateStore(
        private val backing: InMemoryPersistentStateStore,
    ) : PersistentStateStore {
        override val coordinationLock: Any = backing.coordinationLock
        var failNextPutBeforeApply: Boolean = false
        var failNextPutAfterApply: Boolean = false
        var failNextFlush: Boolean = false
        var failingFlushes: Int = 0
        var successfulFlushesBeforeFailure: Int = 0

        override fun getString(key: String): String? = backing.getString(key)

        override fun putString(key: String, value: String) {
            if (failNextPutBeforeApply) {
                failNextPutBeforeApply = false
                throw IllegalStateException("injected write failure")
            }
            backing.putString(key, value)
            if (failNextPutAfterApply) {
                failNextPutAfterApply = false
                throw IllegalStateException("injected post-write failure")
            }
        }

        override fun remove(key: String) = backing.remove(key)
        override fun contains(key: String): Boolean = backing.contains(key)
        override fun clear() = backing.clear()

        override fun flush() {
            if (successfulFlushesBeforeFailure > 0) { successfulFlushesBeforeFailure--; backing.flush(); return }
            if (failingFlushes > 0) { failingFlushes--; throw IllegalStateException("injected repeated flush failure") }
            if (failNextFlush) {
                failNextFlush = false
                throw IllegalStateException("injected flush failure")
            }
            backing.flush()
        }
    }
}
