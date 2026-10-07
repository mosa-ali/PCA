package org.pca.app.runtime.sync

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.pca.app.foundation.PersistentStateStore
import org.pca.app.runtime.sync.envelope.*
import org.pca.app.runtime.sync.inbox.*

class InboundApplicationJournalTest {
    private class Backing : PersistentStateStore {
        val cache = mutableMapOf<String, String>()
        val disk = mutableMapOf<String, String>()
        var failFlush = false
        var ignoreWrites = false
        override fun getString(key: String) = cache[key]
        override fun putString(key: String, value: String) { if (!ignoreWrites) cache[key] = value }
        override fun remove(key: String) { cache.remove(key) }
        override fun contains(key: String) = cache.containsKey(key)
        override fun clear() { cache.clear() }
        override fun flush() { check(!failFlush); disk.clear(); disk.putAll(cache) }
        fun restart() = Backing().also { it.cache.putAll(disk); it.disk.putAll(disk) }
    }
    private val scope = RuntimeInboxScope("family-1", "device-1")
    private fun intent(id: String = "message-1", operation: String = "00000000-0000-0000-0000-000000000001"): InboundApplicationIntent {
        val wire = String(envelopeToRelayCiphertext(FamilyEnvelope(1, 0, id, "family-1", "sender-1",
            RecipientBinding.Device("device-1"), "key-1", "STATUS_SNAPSHOT", 1, 1, "nonce-1",
            1_700_000_000_000L, 1_700_000_060_000L, "1.0.0", null, byteArrayOf(1, 2, 3), "signature-1")), Charsets.UTF_8)
        return InboundApplicationIntent(operation, scope, id, wire, "AQ==", "Ag==", 1_700_000_001_000L)
    }
    private fun unavailable(block: () -> Unit) {
        try { block(); fail("Expected journal rejection") } catch (_: InboundApplicationJournalUnavailable) { }
    }

    @Test fun `restart preserves intent without inventing application receipt`() {
        val backing = Backing()
        val original = intent()
        PersistentInboundApplicationJournal(backing, "device-1").prepare(original)
        val restarted = PersistentInboundApplicationJournal(backing.restart(), "device-1")
        assertEquals(listOf(InboundApplicationRecord(original)), restarted.records())
        assertEquals(original, restarted.prepare(original).intent)
    }

    @Test fun `completion requires exact prepared intent and retains first receipt`() {
        val journal = PersistentInboundApplicationJournal(Backing(), "device-1")
        val original = intent()
        unavailable { journal.complete(original, InboundApplicationOutcome.APPLIED, original.preparedAtEpochMillis) }
        journal.prepare(original)
        unavailable { journal.prepare(original.copy(authorityBinding = "Aw==")) }
        unavailable { journal.complete(original, InboundApplicationOutcome.APPLIED, original.preparedAtEpochMillis - 1) }
        val completed = journal.complete(original, InboundApplicationOutcome.APPLIED, original.preparedAtEpochMillis + 1)
        assertEquals(completed, journal.complete(original, InboundApplicationOutcome.APPLIED, original.preparedAtEpochMillis + 2))
        unavailable { journal.complete(original, InboundApplicationOutcome.REJECTED, original.preparedAtEpochMillis + 2) }
    }

    @Test fun `failed durability never returns confirmed state from cache`() {
        val backing = Backing()
        val journal = PersistentInboundApplicationJournal(backing, "device-1")
        val original = intent()
        backing.failFlush = true
        unavailable { journal.prepare(original) }
        unavailable { journal.records() }
        assertTrue(PersistentInboundApplicationJournal(backing.restart(), "device-1").records().isEmpty())
        backing.failFlush = false
        journal.prepare(original)
        backing.ignoreWrites = true
        unavailable { journal.complete(original, InboundApplicationOutcome.APPLIED, original.preparedAtEpochMillis + 1) }
        assertNull(journal.records().single().outcome)
    }

    @Test fun `strict custody validation also protects journal admission`() {
        val journal = PersistentInboundApplicationJournal(Backing(), "device-1")
        val original = intent()
        unavailable { journal.prepare(original.copy(envelopeWire = JSONObject(original.envelopeWire).put("protocolMajor", "1").toString())) }
        unavailable { journal.prepare(original.copy(envelopeWire = JSONObject(original.envelopeWire).put("payload", "AQID\n").toString())) }
        unavailable { journal.prepare(original.copy(operationId = "0-0-0-0-1")) }
        unavailable { journal.prepare(original.copy(scope = RuntimeInboxScope("family-2", "device-1"))) }
        assertTrue(journal.records().isEmpty())
    }

    @Test fun `failed completion flush preserves prepared operation on restart`() {
        val backing = Backing()
        val journal = PersistentInboundApplicationJournal(backing, "device-1")
        val original = intent()
        journal.prepare(original)
        backing.failFlush = true
        unavailable { journal.complete(original, InboundApplicationOutcome.APPLIED, original.preparedAtEpochMillis + 1) }
        unavailable { journal.records() }
        val restarted = PersistentInboundApplicationJournal(backing.restart(), "device-1")
        assertEquals(InboundApplicationRecord(original), restarted.records().single())
        restarted.complete(original, InboundApplicationOutcome.APPLIED, original.preparedAtEpochMillis + 2)
        assertEquals(original.operationId, restarted.records().single().intent.operationId)
    }

    @Test fun `corrupt persisted outcome pairing fails closed`() {
        val backing = Backing()
        val journal = PersistentInboundApplicationJournal(backing, "device-1")
        journal.prepare(intent())
        val key = backing.cache.keys.single()
        val snapshot = JSONObject(backing.cache.getValue(key))
        snapshot.getJSONArray("records").getJSONObject(0).put("outcome", "APPLIED")
        backing.cache[key] = snapshot.toString()
        unavailable { journal.records() }
    }

    @Test fun `capacity never evicts receipts and cursor survives restart`() {
        val backing = Backing()
        val journal = PersistentInboundApplicationJournal(backing, "device-1", maxRecords = 1)
        val original = intent()
        journal.prepare(original)
        journal.complete(original, InboundApplicationOutcome.APPLIED, original.preparedAtEpochMillis)
        unavailable { journal.prepare(intent("message-2", "00000000-0000-0000-0000-000000000002")) }
        journal.advanceProcessingCursor(scope, "message-2")
        val restarted = PersistentInboundApplicationJournal(backing.restart(), "device-1", maxRecords = 1)
        assertEquals(journal.identity(scope, "message-2"), restarted.processingCursor())
        assertEquals(InboundApplicationOutcome.APPLIED, restarted.records().single().outcome)
    }
}
