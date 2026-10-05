package org.pca.app.runtime.sync

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.pca.app.foundation.PersistentStateStore
import org.pca.app.runtime.sync.envelope.*
import org.pca.app.runtime.sync.inbox.*

private class InboxBacking : PersistentStateStore {
    val values = mutableMapOf<String, String>()
    private val disk = mutableMapOf<String, String>()
    var failFlush = false
    var corruptReadback = false
    var flushCalls = 0
    var failOnFlushNumber: Int? = null
    override fun getString(key: String) = if (corruptReadback && values.containsKey(key)) "{}" else values[key]
    override fun putString(key: String, value: String) { values[key] = value }
    override fun contains(key: String) = values.containsKey(key)
    override fun remove(key: String) { values.remove(key) }
    override fun clear() { values.clear() }
    override fun flush() {
        flushCalls++
        if (failFlush || flushCalls == failOnFlushNumber) error("unavailable")
        disk.clear(); disk.putAll(values)
    }
    fun restarted() = InboxBacking().also { it.values.putAll(disk); it.disk.putAll(disk) }
}

class DurableCiphertextInboxTest {
    private val scope = RuntimeInboxScope("family-1", "device-1")
    private fun wire(id: String = "message-1") = String(envelopeToRelayCiphertext(FamilyEnvelope(
        1, 0, id, "family-1", "sender-1", RecipientBinding.Device("device-1"), "key-1",
        "STATUS_SNAPSHOT", 1, 1, "nonce-1", 1_700_000_000_000L, 1_700_000_060_000L,
        "1.0.0", null, byteArrayOf(1, 2, 3), "signature-1",
    )), Charsets.UTF_8)
    private fun unavailable(block: () -> Unit) {
        try { block(); fail("Expected fail-closed custody") } catch (_: CiphertextInboxUnavailable) { }
    }

    @Test fun `restart preserves full ciphertext and ack never means crypto applied`() {
        val store = InboxBacking()
        val original = wire()
        PersistentCiphertextInbox(store, "device-1").capture(scope, listOf(original))
        val restored = PersistentCiphertextInbox(store.restarted(), "device-1")
        assertEquals(original, restored.pendingAcknowledgements(scope).single().envelopeWire)
        restored.markAcknowledged(scope, "message-1", original)
        assertTrue(restored.pendingAcknowledgements(scope).isEmpty())
        assertEquals(original, restored.pendingCrypto(scope).single().envelopeWire)
        restored.capture(scope, listOf(original))
        assertTrue(restored.pendingAcknowledgements(scope).isEmpty())
    }

    @Test fun `failed durability barrier cannot expose cached ack candidates`() {
        val store = InboxBacking()
        val inbox = PersistentCiphertextInbox(store, "device-1")
        store.failFlush = true
        unavailable { inbox.capture(scope, listOf(wire())) }
        unavailable { inbox.pendingAcknowledgements(scope) }
        unavailable { inbox.capture(scope, listOf(wire())) }
        store.failFlush = false
        assertEquals(1, inbox.pendingAcknowledgements(scope).size)
    }

    @Test fun `readback mismatch rejects capture`() {
        val store = InboxBacking()
        store.corruptReadback = true
        unavailable { PersistentCiphertextInbox(store, "device-1").capture(scope, listOf(wire())) }
    }

    @Test fun `conflicting redelivery and scope substitution preserve original snapshot`() {
        val store = InboxBacking()
        val inbox = PersistentCiphertextInbox(store, "device-1")
        inbox.capture(scope, listOf(wire()))
        val before = store.values.toMap()
        for (key in listOf("signature", "senderKeyId", "sequenceOrNonce", "payload")) {
            val changed = JSONObject(wire()).put(key, if (key == "payload") "BA==" else "changed").toString()
            unavailable { inbox.capture(scope, listOf(changed)) }
        }
        unavailable { inbox.capture(RuntimeInboxScope("other-family", "device-1"), emptyList()) }
        unavailable { inbox.capture(RuntimeInboxScope("family-1", "other-device"), emptyList()) }
        assertEquals(before, store.values)
    }

    @Test fun `malformed wire rejected before any durable write`() {
        for ((key, value) in listOf<Pair<String, Any>>("trustSetEpoch" to 2147483648L,
            "keyEpoch" to -1, "protocolMajor" to 1.5, "payload" to "A!QID",
            "familyId" to "other-family", "recipientDeviceId" to "other-device", "correlationId" to 42,
            "semanticVersion" to "01.0.0", "messageType" to "UNKNOWN", "signature" to "s".repeat(513),
            "sequenceOrNonce" to "n".repeat(129))) {
            val store = InboxBacking()
            unavailable { PersistentCiphertextInbox(store, "device-1").capture(scope,
                listOf(JSONObject(wire()).put(key, value).toString())) }
            assertTrue(store.values.isEmpty())
        }
    }

    @Test fun `capacity rejects whole batch without evicting ciphertext`() {
        val store = InboxBacking()
        val inbox = PersistentCiphertextInbox(store, "device-1", maxRecords = 1)
        inbox.capture(scope, listOf(wire()))
        val before = store.values.toMap()
        unavailable { inbox.capture(scope, listOf(wire("message-2"))) }
        assertEquals(before, store.values)
    }

    @Test fun `corrupt snapshot is never reset to empty`() {
        val store = InboxBacking()
        val inbox = PersistentCiphertextInbox(store, "device-1")
        inbox.capture(scope, listOf(wire()))
        val key = store.values.keys.single()
        store.values[key] = "{\"version\":99}"
        unavailable { inbox.capture(scope, emptyList()) }
        unavailable { inbox.pendingAcknowledgements(scope) }
        assertEquals("{\"version\":99}", store.values[key])
    }

    @Test fun `numeric persisted metadata and duplicate ids fail closed`() {
        for (mutation in listOf<(JSONObject) -> Unit>(
            { it.put("familyId", 42) },
            { it.getJSONArray("records").getJSONObject(0).put("messageId", 42) },
            { it.getJSONArray("records").put(it.getJSONArray("records").getJSONObject(0)) },
            { it.getJSONArray("records").getJSONObject(0).put("acknowledgementPending", "true") },
        )) {
            val store = InboxBacking()
            val inbox = PersistentCiphertextInbox(store, "device-1")
            inbox.capture(scope, listOf(wire()))
            val key = store.values.keys.single()
            val json = JSONObject(store.values.getValue(key))
            mutation(json)
            store.values[key] = json.toString()
            unavailable { inbox.pendingAcknowledgements(scope) }
        }
    }

    @Test fun `failed ack marker flush retains ciphertext and requires a fresh barrier`() {
        val store = InboxBacking()
        val inbox = PersistentCiphertextInbox(store, "device-1")
        inbox.capture(scope, listOf(wire()))
        store.failFlush = true
        unavailable { inbox.markAcknowledged(scope, "message-1", wire()) }
        unavailable { inbox.pendingAcknowledgements(scope) }
        store.failFlush = false
        assertEquals(1, PersistentCiphertextInbox(store, "device-1").pendingAcknowledgements(scope).size)
        assertEquals(wire(), inbox.pendingCrypto(scope).single().envelopeWire)
    }

    @Test fun `unknown wire changes conflict and oversized payload is rejected`() {
        val store = InboxBacking()
        val inbox = PersistentCiphertextInbox(store, "device-1")
        inbox.capture(scope, listOf(wire()))
        unavailable { inbox.capture(scope, listOf(JSONObject(wire()).put("extra", "changed").toString())) }
        val large = java.util.Base64.getEncoder().encodeToString(ByteArray(65537) { 1 })
        unavailable { inbox.capture(scope, listOf(JSONObject(wire("message-2")).put("payload", large).toString())) }
        assertEquals(1, inbox.pendingCrypto(scope).size)
    }

    @Test fun `ack marker write then failed flush restores pending ack from durable disk`() {
        val store = InboxBacking()
        val inbox = PersistentCiphertextInbox(store, "device-1")
        inbox.capture(scope, listOf(wire()))
        // Confirmation flush succeeds; the subsequent marker flush fails.
        store.failOnFlushNumber = store.flushCalls + 2
        unavailable { inbox.markAcknowledged(scope, "message-1", wire()) }
        val restored = PersistentCiphertextInbox(store.restarted(), "device-1")
        assertEquals(1, restored.pendingAcknowledgements(scope).size)
        assertEquals(wire(), restored.pendingCrypto(scope).single().envelopeWire)
    }

    @Test fun `snapshot byte bound failure leaves previous durable data intact`() {
        val store = InboxBacking()
        val inbox = PersistentCiphertextInbox(store, "device-1", maxSnapshotBytes = 1500)
        inbox.capture(scope, listOf(wire()))
        val oversized = JSONObject(wire("message-2")).put("signature", "s".repeat(500)).toString()
        unavailable { inbox.capture(scope, listOf(oversized)) }
        assertEquals(1, PersistentCiphertextInbox(store.restarted(), "device-1").pendingCrypto(scope).size)
    }
}
