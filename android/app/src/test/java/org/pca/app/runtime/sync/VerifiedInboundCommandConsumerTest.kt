package org.pca.app.runtime.sync

import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.launch
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.async
import kotlinx.coroutines.yield
import org.junit.Assert.*
import org.junit.Test
import org.pca.app.foundation.InMemoryPersistentStateStore
import org.pca.app.foundation.PersistentStateStore
import org.pca.app.runtime.sync.envelope.*
import org.pca.app.runtime.sync.inbox.*

class VerifiedInboundCommandConsumerTest {
    private val scope = RuntimeInboxScope("family-1", "device-1")
    private class SharedBacking {
        val lock = Any()
        val values = mutableMapOf<String, String>()
    }
    private class SharedStore(private val backing: SharedBacking) : PersistentStateStore {
        override val coordinationLock: Any = backing.lock
        override fun getString(key: String) = backing.values[key]
        override fun putString(key: String, value: String) { backing.values[key] = value }
        override fun remove(key: String) { backing.values.remove(key) }
        override fun contains(key: String) = backing.values.containsKey(key)
        override fun clear() { backing.values.clear() }
        override fun flush() {}
    }
    private fun candidate(id: String) = CiphertextInboxRecord(id, String(envelopeToRelayCiphertext(FamilyEnvelope(
        1, 0, id, "family-1", "sender-1", RecipientBinding.Device("device-1"), "key-1", "STATUS_SNAPSHOT",
        1, 1, "nonce-1", 1000, 60000, "1.0.0", null, byteArrayOf(1), "signature-1")), Charsets.UTF_8), true)
    private class Handler : InboundCommandApplier {
        val applied = mutableListOf<String>()
        var recovery: InboundEffectRecovery = InboundEffectRecovery.NotApplied
        var onReconcile: () -> Unit = {}
        override suspend fun reconcile(intent: InboundApplicationIntent): InboundEffectRecovery { onReconcile(); return recovery }
        override suspend fun apply(intent: InboundApplicationIntent, assertAuthority: () -> Unit): InboundApplicationOutcome {
            assertAuthority(); applied.add(intent.operationId); return InboundApplicationOutcome.APPLIED
        }
    }
    private fun verifier(revalidate: () -> Unit = {}) = InboundCommandVerifier { _, _ -> InboundVerificationResult.Accepted("AQ==", "Ag==", revalidate) }

    @Test fun `unavailable verification never prepares or applies`() = runBlocking {
        val journal = PersistentInboundApplicationJournal(InMemoryPersistentStateStore(), "device-1")
        val handler = Handler()
        val consumer = VerifiedInboundCommandConsumer(journal, UnavailableInboundCommandVerifier, handler, { 2000 })
        assertEquals(0, consumer.consume(listOf(candidate("one")), scope) {})
        assertTrue(journal.records().isEmpty()); assertTrue(handler.applied.isEmpty())
    }

    @Test fun `permanent denial suppresses aliases without manufacturing application receipts`() = runBlocking {
        val store = InMemoryPersistentStateStore()
        val journal = PersistentInboundApplicationJournal(store, "device-1")
        val denial = PersistentInboundReplayDenialLedger(store, "device-1").also { it.initializeFresh {} }
        denial.install(InboundReplayRetirementBoundary(scope, "AQ==", 0, 0, mapOf("key-1" to 1))) {}
        val handler = Handler()
        val consumer = VerifiedInboundCommandConsumer(journal, verifier(), handler, { 2000 }, replayDenial = denial)
        assertEquals(0, consumer.consume(listOf(candidate("one"), candidate("alias")), scope) {})
        assertTrue(handler.applied.isEmpty()); assertTrue(journal.records().isEmpty())
        assertTrue(consumer.pending(listOf(candidate("alias")), scope).isEmpty())
    }

    @Test fun `retirement latch rejects future legacy consumers without configured denial storage`() = runBlocking {
        val store = InMemoryPersistentStateStore()
        val journal = PersistentInboundApplicationJournal(store, "device-1")
        val denial = PersistentInboundReplayDenialLedger(store, "device-1").also { it.initializeFresh {} }
        journal.requireReplayDenial()
        val legacy = VerifiedInboundCommandConsumer(journal, verifier(), Handler(), { 2000 })
        try { legacy.consume(listOf(candidate("retired-alias")), scope) {}; fail("Legacy consumer must honor retirement latch") }
        catch (_: InboundApplicationJournalUnavailable) { }
        assertTrue(journal.records().isEmpty())
        val matching = VerifiedInboundCommandConsumer(journal, verifier(), Handler(), { 2000 }, replayDenial = denial)
        try { matching.consume(emptyList(), scope) {}; fail("Latch requires a durable installed boundary") }
        catch (_: InboundApplicationJournalUnavailable) { }
        denial.install(InboundReplayRetirementBoundary(scope, "AQ==", 0, 0, mapOf("key-1" to 1))) {}
        assertEquals(0, matching.consume(listOf(candidate("retired-alias")), scope) {})
    }


    @Test fun `denied prepared operation can reconcile completion but cannot initiate new effect`() = runBlocking {
        val store = InMemoryPersistentStateStore()
        val journal = PersistentInboundApplicationJournal(store, "device-1")
        val denial = PersistentInboundReplayDenialLedger(store, "device-1").also { it.initializeFresh {} }
        val handler = Handler().also { it.recovery = InboundEffectRecovery.Unknown }
        val consumer = VerifiedInboundCommandConsumer(journal, verifier(), handler, { 2000 }, replayDenial = denial)
        val candidates = listOf(candidate("one"))
        assertEquals(0, consumer.consume(candidates, scope) {})
        val operation = journal.records().single().intent.operationId
        denial.install(InboundReplayRetirementBoundary(scope, "AQ==", 0, 0, mapOf("key-1" to 1))) {}
        handler.recovery = InboundEffectRecovery.NotApplied
        assertEquals(0, consumer.consume(candidates, scope) {})
        assertEquals(1, consumer.pending(candidates, scope).size)
        assertTrue(handler.applied.isEmpty()); assertNull(journal.records().single().outcome)
        handler.recovery = InboundEffectRecovery.Completed(InboundApplicationOutcome.APPLIED)
        assertEquals(1, consumer.consume(candidates, scope) {})
        assertEquals(operation, journal.records().single().intent.operationId)
        assertEquals(InboundApplicationOutcome.APPLIED, journal.records().single().outcome)
        assertTrue(handler.applied.isEmpty())
    }

    @Test fun `denial installed during suspended application blocks actual effect`() = runBlocking {
        val store = InMemoryPersistentStateStore()
        val journal = PersistentInboundApplicationJournal(store, "device-1")
        val denial = PersistentInboundReplayDenialLedger(store, "device-1").also { it.initializeFresh {} }
        val entered = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        var effected = false
        val handler = object : InboundCommandApplier {
            override suspend fun reconcile(intent: InboundApplicationIntent) = InboundEffectRecovery.NotApplied
            override suspend fun apply(intent: InboundApplicationIntent, assertAuthority: () -> Unit): InboundApplicationOutcome {
                entered.complete(Unit); release.await(); assertAuthority()
                effected = true; return InboundApplicationOutcome.APPLIED
            }
        }
        val consumer = VerifiedInboundCommandConsumer(journal, verifier(), handler, { 2000 }, replayDenial = denial)
        val task = launch { assertEquals(0, consumer.consume(listOf(candidate("one")), scope) {}) }
        entered.await()
        denial.install(InboundReplayRetirementBoundary(scope, "AQ==", 0, 0, mapOf("key-1" to 1))) {}
        release.complete(Unit); task.join()
        assertFalse(effected); assertNull(journal.records().single().outcome)
    }

    @Test fun `configured missing denial state blocks even an empty campaign`() = runBlocking {
        val store = InMemoryPersistentStateStore()
        val journal = PersistentInboundApplicationJournal(store, "device-1")
        val handler = Handler()
        val consumer = VerifiedInboundCommandConsumer(journal, verifier(), handler, { 2000 },
            replayDenial = PersistentInboundReplayDenialLedger(store, "device-1"))
        try { consumer.consume(emptyList(), scope) {}; fail("Expected missing denial state") } catch (_: InboundReplayDenialUnavailable) { }
        assertTrue(handler.applied.isEmpty()); assertTrue(journal.records().isEmpty())
    }

    @Test fun `denial loss during suspended completed recovery prevents terminal publication`() = runBlocking {
        val store = InMemoryPersistentStateStore()
        val journal = PersistentInboundApplicationJournal(store, "device-1")
        val denial = PersistentInboundReplayDenialLedger(store, "device-1").also { it.initializeFresh {} }
        val entered = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        var rejected = false
        val handler = object : InboundCommandApplier {
            override suspend fun reconcile(intent: InboundApplicationIntent): InboundEffectRecovery {
                entered.complete(Unit); release.await()
                return InboundEffectRecovery.Completed(InboundApplicationOutcome.APPLIED)
            }
            override suspend fun apply(intent: InboundApplicationIntent, assertAuthority: () -> Unit): InboundApplicationOutcome = error("Recovery must not apply")
        }
        val consumer = VerifiedInboundCommandConsumer(journal, verifier(), handler, { 2000 }, replayDenial = denial)
        val task = launch {
            try { consumer.consume(listOf(candidate("one")), scope) {} }
            catch (_: InboundReplayDenialUnavailable) { rejected = true }
        }
        entered.await()
        val suffix = java.util.Base64.getUrlEncoder().withoutPadding().encodeToString("device-1".toByteArray(Charsets.UTF_8))
        store.remove("runtime.inbound-replay-denial.v1.$suffix")
        release.complete(Unit); task.join()
        assertTrue(rejected); assertNull(journal.records().single().outcome)
    }

    @Test fun `independent consumers sharing a device store serialize the same operation`() = runBlocking {
        val backing = SharedBacking()
        val firstStore = SharedStore(backing)
        val secondStore = SharedStore(backing)
        val entered = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        val effects = mutableListOf<String>()
        val handler = object : InboundCommandApplier {
            override suspend fun reconcile(intent: InboundApplicationIntent): InboundEffectRecovery {
                entered.complete(Unit); release.await(); return InboundEffectRecovery.NotApplied
            }
            override suspend fun apply(intent: InboundApplicationIntent, assertAuthority: () -> Unit): InboundApplicationOutcome {
                assertAuthority(); effects.add(intent.operationId); return InboundApplicationOutcome.APPLIED
            }
        }
        val candidates = listOf(candidate("one"))
        val firstJournal = PersistentInboundApplicationJournal(firstStore, "device-1")
        val secondJournal = PersistentInboundApplicationJournal(secondStore, "device-1")
        val first = VerifiedInboundCommandConsumer(firstJournal, verifier(), handler, { 2000 })
        val second = VerifiedInboundCommandConsumer(secondJournal, verifier(), handler, { 2000 })
        val denial = PersistentInboundReplayDenialLedger(secondStore, "device-1").also { it.initializeFresh {} }
        assertNotNull(VerifiedInboundReplayReclaimer(firstJournal,
            PersistentCiphertextInbox(secondStore, "device-1"), denial))
        val firstTask = async { first.consume(candidates, scope) {} }
        entered.await()
        val secondTask = async { second.consume(candidates, scope) {} }
        yield()
        assertFalse(secondTask.isCompleted); assertTrue(effects.isEmpty())
        release.complete(Unit)
        assertEquals(1, firstTask.await()); assertEquals(0, secondTask.await())
        assertEquals(1, effects.size)
    }

    @Test fun `retirement latch requires a boundary for the exact family scope`() {
        val store = InMemoryPersistentStateStore()
        val journal = PersistentInboundApplicationJournal(store, "device-1")
        val otherFamily = RuntimeInboxScope("family-2", "device-1")
        val denial = PersistentInboundReplayDenialLedger(store, "device-1").also { it.initializeFresh {} }
        denial.install(InboundReplayRetirementBoundary(otherFamily, "AQ==", 0, 0)) {}
        journal.requireReplayDenial()
        val consumer = VerifiedInboundCommandConsumer(journal, verifier(), Handler(), { 2000 }, replayDenial = denial)
        try {
            consumer.pending(listOf(candidate("one")), scope)
            fail("A different family boundary must not clear this scope's retirement latch")
        } catch (_: InboundApplicationJournalUnavailable) { }
    }

    @Test fun `unknown effect retains operation and terminal duplicate never reapplies`() = runBlocking {
        val journal = PersistentInboundApplicationJournal(InMemoryPersistentStateStore(), "device-1")
        val handler = Handler().also { it.recovery = InboundEffectRecovery.Unknown }
        val consumer = VerifiedInboundCommandConsumer(journal, verifier(), handler, { 2000 })
        val candidates = listOf(candidate("one"))
        assertEquals(0, consumer.consume(candidates, scope) {})
        val operation = journal.records().single().intent.operationId
        handler.recovery = InboundEffectRecovery.NotApplied
        assertEquals(1, consumer.consume(candidates, scope) {})
        assertEquals(listOf(operation), handler.applied)
        assertEquals(0, consumer.consume(candidates, scope) {})
        assertEquals(listOf(operation), handler.applied)
    }

    @Test fun `fresh authority failure after recovery prevents effect and receipt`() = runBlocking {
        val journal = PersistentInboundApplicationJournal(InMemoryPersistentStateStore(), "device-1")
        var valid = true
        val handler = Handler().also { it.onReconcile = { valid = false } }
        val consumer = VerifiedInboundCommandConsumer(journal, verifier { check(valid) }, handler, { 2000 })
        try { consumer.consume(listOf(candidate("one")), scope) {}; fail("Expected lost authority") } catch (_: IllegalStateException) { }
        assertTrue(handler.applied.isEmpty()); assertNull(journal.records().single().outcome)
    }

    @Test fun `expiry during reconciliation defers new effect`() = runBlocking {
        val journal = PersistentInboundApplicationJournal(InMemoryPersistentStateStore(), "device-1")
        var now = 2000L
        val handler = Handler().also { it.onReconcile = { now = 60000 } }
        val consumer = VerifiedInboundCommandConsumer(journal, verifier(), handler, { now })
        assertEquals(0, consumer.consume(listOf(candidate("one")), scope) {})
        assertTrue(handler.applied.isEmpty()); assertNull(journal.records().single().outcome)
    }

    @Test fun `unavailable prefix does not starve valid suffix across consumer restart`() = runBlocking {
        val store = InMemoryPersistentStateStore()
        val handler = Handler()
        val verifier = InboundCommandVerifier { record, _ ->
            if (record.messageId != "message-32") InboundVerificationResult.Unavailable
            else InboundVerificationResult.Accepted("AQ==", "Ag==") {}
        }
        val candidates = (0..32).map { candidate("message-$it") }
        val first = VerifiedInboundCommandConsumer(PersistentInboundApplicationJournal(store, "device-1"), verifier, handler, { 2000 })
        assertEquals(0, first.consume(candidates, scope) {})
        val second = VerifiedInboundCommandConsumer(PersistentInboundApplicationJournal(store, "device-1"), verifier, handler, { 2000 })
        assertEquals(1, second.consume(candidates, scope) {})
        assertEquals(1, handler.applied.size)
    }

    @Test fun `proven existing effect may publish receipt after expiry without reapplication`() = runBlocking {
        val journal = PersistentInboundApplicationJournal(InMemoryPersistentStateStore(), "device-1")
        val handler = Handler().also { it.recovery = InboundEffectRecovery.Unknown }
        var now = 2000L
        val consumer = VerifiedInboundCommandConsumer(journal, verifier(), handler, { now })
        val candidates = listOf(candidate("one"))
        assertEquals(0, consumer.consume(candidates, scope) {})
        now = 60000
        handler.recovery = InboundEffectRecovery.Completed(InboundApplicationOutcome.APPLIED)
        assertEquals(1, consumer.consume(candidates, scope) {})
        assertTrue(handler.applied.isEmpty())
        assertEquals(InboundApplicationOutcome.APPLIED, journal.records().single().outcome)
    }

    @Test fun `cancellation while verifier is suspended produces no intent or effect`() = runBlocking {
        val journal = PersistentInboundApplicationJournal(InMemoryPersistentStateStore(), "device-1")
        val entered = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        val handler = Handler()
        val verifier = InboundCommandVerifier { _, _ ->
            entered.complete(Unit); release.await()
            InboundVerificationResult.Accepted("AQ==", "Ag==") {}
        }
        val consumer = VerifiedInboundCommandConsumer(journal, verifier, handler, { 2000 })
        val task = launch { consumer.consume(listOf(candidate("one")), scope) {} }
        entered.await(); task.cancelAndJoin()
        assertTrue(journal.records().isEmpty()); assertTrue(handler.applied.isEmpty())
    }

    @Test fun `expiry during application suspension is checked at actual effect boundary`() = runBlocking {
        val journal = PersistentInboundApplicationJournal(InMemoryPersistentStateStore(), "device-1")
        val entered = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        var now = 2000L
        var effected = false
        val handler = object : InboundCommandApplier {
            override suspend fun reconcile(intent: InboundApplicationIntent) = InboundEffectRecovery.NotApplied
            override suspend fun apply(intent: InboundApplicationIntent, assertAuthority: () -> Unit): InboundApplicationOutcome {
                entered.complete(Unit); release.await(); assertAuthority()
                effected = true; return InboundApplicationOutcome.APPLIED
            }
        }
        val consumer = VerifiedInboundCommandConsumer(journal, verifier(), handler, { now })
        val task = launch { assertEquals(0, consumer.consume(listOf(candidate("one")), scope) {}) }
        entered.await(); now = 60000; release.complete(Unit); task.join()
        assertFalse(effected); assertNull(journal.records().single().outcome)
    }

    @Test fun `changed verified binding cannot replace prepared operation`() = runBlocking {
        val journal = PersistentInboundApplicationJournal(InMemoryPersistentStateStore(), "device-1")
        val handler = Handler().also { it.recovery = InboundEffectRecovery.Unknown }
        val candidates = listOf(candidate("one"))
        val first = VerifiedInboundCommandConsumer(journal, verifier(), handler, { 2000 })
        assertEquals(0, first.consume(candidates, scope) {})
        val original = journal.records().single().intent
        handler.recovery = InboundEffectRecovery.NotApplied
        val changed = InboundCommandVerifier { _, _ -> InboundVerificationResult.Accepted("Aw==", "Ag==") {} }
        val second = VerifiedInboundCommandConsumer(journal, changed, handler, { 2000 })
        try { second.consume(candidates, scope) {}; fail("Expected binding conflict") } catch (_: InboundCommandConsumerUnavailable) { }
        assertEquals(original, journal.records().single().intent)
        assertNull(journal.records().single().outcome); assertTrue(handler.applied.isEmpty())
    }

    @Test fun `revoked authority during suspended application prevents actual effect`() = runBlocking {
        val journal = PersistentInboundApplicationJournal(InMemoryPersistentStateStore(), "device-1")
        val entered = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        var authorityCurrent = true
        var effected = false
        var rejected = false
        val handler = object : InboundCommandApplier {
            override suspend fun reconcile(intent: InboundApplicationIntent) = InboundEffectRecovery.NotApplied
            override suspend fun apply(intent: InboundApplicationIntent, assertAuthority: () -> Unit): InboundApplicationOutcome {
                entered.complete(Unit); release.await(); assertAuthority()
                effected = true; return InboundApplicationOutcome.APPLIED
            }
        }
        val consumer = VerifiedInboundCommandConsumer(journal, verifier { check(authorityCurrent) }, handler, { 2000 })
        val task = launch {
            try { consumer.consume(listOf(candidate("one")), scope) {} }
            catch (_: IllegalStateException) { rejected = true }
        }
        entered.await(); authorityCurrent = false; release.complete(Unit); task.join()
        assertTrue(rejected); assertFalse(effected); assertNull(journal.records().single().outcome)
    }

    @Test fun `effect followed by failed terminal write recovers original operation without applying twice`() = runBlocking {
        val backing = InMemoryPersistentStateStore()
        var ignoreWrites = false
        val store = object : PersistentStateStore by backing {
            override fun putString(key: String, value: String) { if (!ignoreWrites) backing.putString(key, value) }
        }
        val journal = PersistentInboundApplicationJournal(store, "device-1")
        val effects = mutableListOf<String>()
        val firstHandler = object : InboundCommandApplier {
            override suspend fun reconcile(intent: InboundApplicationIntent) = InboundEffectRecovery.NotApplied
            override suspend fun apply(intent: InboundApplicationIntent, assertAuthority: () -> Unit): InboundApplicationOutcome {
                assertAuthority(); effects.add(intent.operationId); ignoreWrites = true
                return InboundApplicationOutcome.APPLIED
            }
        }
        val candidates = listOf(candidate("one"))
        val first = VerifiedInboundCommandConsumer(journal, verifier(), firstHandler, { 2000 })
        try { first.consume(candidates, scope) {}; fail("Expected failed receipt") } catch (_: InboundApplicationJournalUnavailable) { }
        assertEquals(1, effects.size)
        val original = journal.records().single().intent
        assertEquals(effects.single(), original.operationId); assertNull(journal.records().single().outcome)
        ignoreWrites = false
        val recoveredJournal = PersistentInboundApplicationJournal(store, "device-1")
        val recoveryHandler = object : InboundCommandApplier {
            override suspend fun reconcile(intent: InboundApplicationIntent): InboundEffectRecovery {
                assertEquals(original, intent)
                return InboundEffectRecovery.Completed(InboundApplicationOutcome.APPLIED)
            }
            override suspend fun apply(intent: InboundApplicationIntent, assertAuthority: () -> Unit): InboundApplicationOutcome = error("Must reconcile existing effect")
        }
        val second = VerifiedInboundCommandConsumer(recoveredJournal, verifier(), recoveryHandler, { 2000 })
        assertEquals(1, second.consume(candidates, scope) {})
        assertEquals(InboundApplicationOutcome.APPLIED, recoveredJournal.records().single().outcome)
        assertEquals(listOf(original.operationId), effects)
    }
}
