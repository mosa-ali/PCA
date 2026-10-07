package org.pca.app.runtime.sync

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import org.pca.app.foundation.PersistentStateStore
import org.pca.app.runtime.sync.envelope.*
import org.pca.app.runtime.sync.inbox.*

class VerifiedInboundReplayReclaimerTest {
    private class Backing : PersistentStateStore {
        val cache = mutableMapOf<String, String>()
        val disk = mutableMapOf<String, String>()
        var ignoredKey: String? = null
        override fun getString(key: String) = cache[key]
        override fun putString(key: String, value: String) { if (ignoredKey?.let { key.contains(it) } != true) cache[key] = value }
        override fun remove(key: String) { cache.remove(key) }
        override fun contains(key: String) = cache.containsKey(key)
        override fun clear() { cache.clear() }
        override fun flush() { disk.clear(); disk.putAll(cache) }
        fun restart() = Backing().also { it.cache.putAll(disk); it.disk.putAll(disk) }
    }
    private val scope = RuntimeInboxScope("family-1", "device-1")
    private fun wire(id: String, sequence: Int, trust: Long = 1) = String(envelopeToRelayCiphertext(FamilyEnvelope(
        1, 0, id, "family-1", "sender-1", RecipientBinding.Device("device-1"), "key-1", "STATUS_SNAPSHOT",
        trust, 1, sequence.toString(), 1000, 60000, "1.0.0", null, byteArrayOf(1), "signature-1")), Charsets.UTF_8)
    private fun denial(store: Backing) = PersistentInboundReplayDenialLedger(store, "device-1").also { it.initializeFresh {} }
    private fun verifier(through: Long) = InboundRetirementVerifier { accepted(through) }
    private fun accepted(through: Long) = InboundRetirementVerification.Accepted(
        InboundReplayRetirementBoundary(scope, "AQ==", 0, 0, mapOf("key-1" to through))) {}
    private fun seed(store: Backing, id: String, sequence: Int, terminal: Boolean = true, acknowledged: Boolean = true): InboundApplicationIntent {
        val inbox = PersistentCiphertextInbox(store, "device-1")
        val journal = PersistentInboundApplicationJournal(store, "device-1")
        val wire = wire(id, sequence)
        inbox.capture(scope, listOf(wire))
        val intent = InboundApplicationIntent(java.util.UUID.randomUUID().toString(), scope, id, wire, "AQ==", "Ag==", 2000)
        journal.prepare(intent)
        if (terminal) journal.complete(intent, InboundApplicationOutcome.APPLIED, 2000)
        if (acknowledged) inbox.markAcknowledged(scope, id, wire)
        return intent
    }

    @Test fun `more than 256 verified applications reclaim bounded journals and deny replay aliases`() = runBlocking {
        val store = Backing()
        val inbox = PersistentCiphertextInbox(store, "device-1")
        val journal = PersistentInboundApplicationJournal(store, "device-1")
        val denial = denial(store)
        val effects = mutableListOf<String>()
        val consumer = VerifiedInboundCommandConsumer(journal,
            InboundCommandVerifier { _, _ -> InboundVerificationResult.Accepted("AQ==", "Ag==") {} },
            object : InboundCommandApplier {
                override suspend fun reconcile(intent: InboundApplicationIntent) = InboundEffectRecovery.NotApplied
                override suspend fun apply(intent: InboundApplicationIntent, assertAuthority: () -> Unit): InboundApplicationOutcome {
                    assertAuthority(); effects.add(intent.operationId); return InboundApplicationOutcome.APPLIED
                }
            }, { 2000 }, replayDenial = denial)
        for (index in 0 until 310) {
            val id = "command-$index"
            val wire = wire(id, index)
            inbox.capture(scope, listOf(wire))
            assertEquals(1, consumer.consume(inbox.pendingCrypto(scope), scope) {})
            inbox.markAcknowledged(scope, id, wire)
            assertEquals(1, VerifiedInboundReplayReclaimer(journal, inbox, denial, verifier(index.toLong())).reclaim(scope) {})
            assertTrue(journal.records().isEmpty()); assertTrue(inbox.pendingCrypto(scope).isEmpty())
        }
        assertEquals(310, effects.size)
        val retirementReclaimer = VerifiedInboundReplayReclaimer(journal, inbox, denial, verifier(309))
        for (index in 0 until 256) {
            val replay = wire("alternate-id-$index", 1)
            inbox.capture(scope, listOf(replay))
            assertEquals(0, consumer.consume(inbox.pendingCrypto(scope), scope) {})
            inbox.markAcknowledged(scope, "alternate-id-$index", replay)
        }
        assertEquals(256, inbox.pendingCrypto(scope).size)
        try { inbox.capture(scope, listOf(wire("overflow-alias", 1))); fail("A full inbox must reject new ciphertext") }
        catch (_: CiphertextInboxUnavailable) { }
        assertEquals(256, retirementReclaimer.reclaim(scope) {})
        assertTrue(inbox.pendingCrypto(scope).isEmpty()); assertTrue(journal.records().isEmpty())
        val restoredStore = store.restart()
        val restored = PersistentInboundReplayDenialLedger(restoredStore, "device-1")
        assertTrue(PersistentCiphertextInbox(restoredStore, "device-1").pendingCrypto(scope).isEmpty())
        assertTrue(PersistentInboundApplicationJournal(restoredStore, "device-1").records().isEmpty())
        assertTrue(restored.coversReplayIdentityPermanently(PersistentCiphertextInbox.validateEnvelope(wire("alternate-id-0", 1), scope), scope))
        val legitimate = wire("after-retirement", 310)
        inbox.capture(scope, listOf(legitimate))
        assertEquals(1, consumer.consume(inbox.pendingCrypto(scope), scope) {})
        assertEquals(311, effects.size)
    }

    @Test fun `inbox-only permanently denied replay waits for custody ACK before reclamation`() = runBlocking {
        val store = Backing()
        val inbox = PersistentCiphertextInbox(store, "device-1")
        val journal = PersistentInboundApplicationJournal(store, "device-1")
        val denial = denial(store)
        val replay = wire("pending-replay", 1)
        inbox.capture(scope, listOf(replay))
        val reclaimer = VerifiedInboundReplayReclaimer(journal, inbox, denial, verifier(1))

        assertEquals(0, reclaimer.reclaim(scope) {})
        assertEquals(1, inbox.pendingAcknowledgements(scope).size)
        assertEquals(1, inbox.pendingCrypto(scope).size)

        inbox.markAcknowledged(scope, "pending-replay", replay)
        assertEquals(1, reclaimer.reclaim(scope) {})
        assertTrue(inbox.pendingCrypto(scope).isEmpty())
        assertTrue(journal.records().isEmpty())
    }

    @Test fun `cleanup preserves prepared operations and pending ACKs`() = runBlocking {
        val store = Backing()
        val denial = denial(store)
        seed(store, "eligible", 1)
        val pendingAck = seed(store, "pending-ack", 2, acknowledged = false)
        val prepared = seed(store, "prepared", 3, terminal = false)
        val journal = PersistentInboundApplicationJournal(store, "device-1")
        val inbox = PersistentCiphertextInbox(store, "device-1")
        assertEquals(1, VerifiedInboundReplayReclaimer(journal, inbox, denial, verifier(3)).reclaim(scope) {})
        assertEquals(setOf(pendingAck.operationId, prepared.operationId), journal.records().map { it.intent.operationId }.toSet())
        assertEquals(setOf("pending-ack", "prepared"), inbox.pendingCrypto(scope).map { it.messageId }.toSet())
        assertNull(journal.records().single { it.intent == prepared }.outcome)
        assertEquals(1, inbox.pendingAcknowledgements(scope).size)
    }

    @Test fun `epoch only proof cannot delete old terminal replay identities`() = runBlocking {
        val store = Backing()
        val denial = denial(store)
        val original = seed(store, "old", 1)
        val journal = PersistentInboundApplicationJournal(store, "device-1")
        val inbox = PersistentCiphertextInbox(store, "device-1")
        val proof = InboundRetirementVerifier { InboundRetirementVerification.Accepted(InboundReplayRetirementBoundary(scope, "AQ==", 2, 0)) {} }
        assertEquals(0, VerifiedInboundReplayReclaimer(journal, inbox, denial, proof).reclaim(scope) {})
        assertEquals(original, journal.records().single().intent)
        assertEquals(1, inbox.pendingCrypto(scope).size)
        assertTrue(denial.isEnvelopeDenied(PersistentCiphertextInbox.validateEnvelope(original.envelopeWire, scope), scope))
    }

    @Test fun `failed journal deletion after ciphertext removal resumes safely after restart`() = runBlocking {
        val store = Backing()
        val denial = denial(store)
        val original = seed(store, "one", 1)
        val journal = PersistentInboundApplicationJournal(store, "device-1")
        val inbox = PersistentCiphertextInbox(store, "device-1")
        var failedAfterCiphertextDeletion = false
        val assertAuthority = {
            if (!failedAfterCiphertextDeletion && PersistentCiphertextInbox(store, "device-1").pendingCrypto(scope).isEmpty()) {
                failedAfterCiphertextDeletion = true
                store.ignoredKey = "runtime.inbound-application.v1.ZGV2aWNlLTE"
            }
        }
        try { VerifiedInboundReplayReclaimer(journal, inbox, denial, verifier(1)).reclaim(scope, assertAuthority); fail("Expected journal readback failure") }
        catch (_: InboundApplicationJournalUnavailable) { }
        assertTrue("failure injection must happen only after ciphertext deletion", failedAfterCiphertextDeletion)
        val restarted = store.restart()
        val restoredJournal = PersistentInboundApplicationJournal(restarted, "device-1")
        val restoredInbox = PersistentCiphertextInbox(restarted, "device-1")
        val restoredDenial = PersistentInboundReplayDenialLedger(restarted, "device-1")
        assertTrue(restoredInbox.pendingCrypto(scope).isEmpty())
        assertEquals(original, restoredJournal.records().single().intent)
        assertTrue(restoredDenial.coversReplayIdentityPermanently(PersistentCiphertextInbox.validateEnvelope(original.envelopeWire, scope), scope))
        assertEquals(1, VerifiedInboundReplayReclaimer(restoredJournal, restoredInbox, restoredDenial, verifier(1)).reclaim(scope) {})
        assertTrue(restoredJournal.records().isEmpty())
    }

    @Test fun `failed denial write prevents both deletion phases`() = runBlocking {
        val store = Backing()
        val denial = denial(store)
        val original = seed(store, "one", 1)
        val journal = PersistentInboundApplicationJournal(store, "device-1")
        val inbox = PersistentCiphertextInbox(store, "device-1")
        store.ignoredKey = "inbound-replay-denial"
        try { VerifiedInboundReplayReclaimer(journal, inbox, denial, verifier(1)).reclaim(scope) {}; fail("Expected denial write failure") }
        catch (_: InboundReplayDenialUnavailable) { }
        assertEquals(original, journal.records().single().intent)
        assertEquals(1, inbox.pendingCrypto(scope).size)
        assertTrue(denial.boundaries().isEmpty())
        val latchGuard = VerifiedInboundCommandConsumer(journal, InboundCommandVerifier { _, _ ->
            InboundVerificationResult.Accepted("AQ==", "Ag==") {}
        }, object : InboundCommandApplier {
            override suspend fun reconcile(intent: InboundApplicationIntent) = InboundEffectRecovery.NotApplied
            override suspend fun apply(intent: InboundApplicationIntent, assertAuthority: () -> Unit): InboundApplicationOutcome = error("Latch must prevent effects")
        }, { 2000 })
        try { latchGuard.consume(inbox.pendingCrypto(scope), scope) {}; fail("Journal latch must require denial ledger") }
        catch (_: InboundApplicationJournalUnavailable) { }
    }

    @Test fun `unavailable retirement verification preserves all records`() = runBlocking {
        val store = Backing()
        val denial = denial(store)
        seed(store, "one", 1)
        val journal = PersistentInboundApplicationJournal(store, "device-1")
        val inbox = PersistentCiphertextInbox(store, "device-1")
        assertEquals(0, VerifiedInboundReplayReclaimer(journal, inbox, denial).reclaim(scope) {})
        assertEquals(1, journal.records().size); assertEquals(1, inbox.pendingCrypto(scope).size)
        assertTrue(denial.boundaries().isEmpty())
    }

    @Test fun `authority change during suspended retirement verification prevents denial installation`() = runBlocking {
        val store = Backing()
        val denial = denial(store)
        seed(store, "one", 1)
        val journal = PersistentInboundApplicationJournal(store, "device-1")
        val inbox = PersistentCiphertextInbox(store, "device-1")
        val entered = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        var current = true
        var rejected = false
        val verifier = InboundRetirementVerifier { entered.complete(Unit); release.await(); accepted(1) }
        val task = launch {
            try { VerifiedInboundReplayReclaimer(journal, inbox, denial, verifier).reclaim(scope) { check(current) } }
            catch (_: IllegalStateException) { rejected = true }
        }
        entered.await(); current = false; release.complete(Unit); task.join()
        assertTrue(rejected); assertTrue(denial.boundaries().isEmpty())
        assertEquals(1, journal.records().size); assertEquals(1, inbox.pendingCrypto(scope).size)
    }
}
