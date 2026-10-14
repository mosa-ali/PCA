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
    var failOnFlushNumbers: Set<Int> = emptySet()
    var putCalls = 0
    var failOnPutNumber: Int? = null
    override fun getString(key: String) = if (corruptReadback && values.containsKey(key)) "{}" else values[key]
    override fun putString(key: String, value: String) {
        putCalls++
        if (putCalls == failOnPutNumber) error("unavailable")
        values[key] = value
    }
    override fun contains(key: String) = values.containsKey(key)
    override fun remove(key: String) { values.remove(key) }
    override fun clear() { values.clear() }
    override fun flush() {
        flushCalls++
        if (failFlush || flushCalls == failOnFlushNumber || flushCalls in failOnFlushNumbers) error("unavailable")
        disk.clear(); disk.putAll(values)
    }
    fun restarted() = InboxBacking().also { it.values.putAll(disk); it.disk.putAll(disk) }
}

class DurableCiphertextInboxTest {
    @Test fun `legacy held receipt remains unresolved without navigation or acknowledgement`() {
        val inbox = PersistentCiphertextInbox(InboxBacking(), "device-1")
        val receipt = org.pca.app.runtime.sync.transport.InboundReceipt("held-1",
            org.pca.app.runtime.sync.transport.InboundReceiptOutcome.HELD_PENDING, "2026-10-07T00:00:00.000Z")
        inbox.capture(scope, emptyList(), receipts = listOf(receipt))
        assertTrue(inbox.hasUnresolvedRelayWork())
        assertTrue(inbox.pendingAcknowledgements(scope).isEmpty())
        assertEquals(0, inbox.pendingCryptoCount())
    }

    private val incarnation = "a".repeat(64)
    private fun navigation(cursor: String?, unresolved: Boolean = false) =
        org.pca.app.runtime.sync.transport.InboundNavigation(cursor, cursor != null, unresolved, incarnation)

    @Test fun `restart restores cursor receipts and acknowledgement in one snapshot`() {
        val store = InboxBacking()
        val receipt = org.pca.app.runtime.sync.transport.InboundReceipt("message-1",
            org.pca.app.runtime.sync.transport.InboundReceiptOutcome.APPLIED, "2026-10-07T00:00:00.000Z")
        val inbox = PersistentCiphertextInbox(store, "device-1")
        inbox.capture(scope, listOf(wire()), listOf(receipt), navigation("cursor1"), incarnation, null)
        val restored = PersistentCiphertextInbox(store.restarted(), "device-1")
        assertEquals("cursor1", restored.navigationFor(incarnation)?.nextCursor)
        assertEquals(1, restored.pendingAcknowledgements(scope).size)
        val snapshot = JSONObject(store.values.values.single())
        assertEquals(1, snapshot.getJSONArray("receipts").length())
        assertEquals(2, snapshot.getInt("version"))
    }

    @Test fun `rotation clears navigation but preserves ciphertext and pending acknowledgements`() {
        val store = InboxBacking()
        val inbox = PersistentCiphertextInbox(store, "device-1")
        inbox.capture(scope, listOf(wire()), navigation = navigation("cursor1"),
            expectedSessionIncarnation = incarnation)
        assertNull(inbox.navigationFor("b".repeat(64)))
        val restored = PersistentCiphertextInbox(store.restarted(), "device-1")
        assertNull(restored.navigationFor(incarnation))
        assertEquals(1, restored.pendingCryptoCount())
        assertEquals(1, restored.pendingAcknowledgements(scope).size)
    }

    @Test fun `failed cursor flush cannot be exposed or survive process restart`() {
        val store = InboxBacking()
        val inbox = PersistentCiphertextInbox(store, "device-1")
        inbox.capture(scope, listOf(wire()), navigation = navigation("cursor1"),
            expectedSessionIncarnation = incarnation)
        store.failFlush = true
        unavailable { inbox.capture(scope, emptyList(), navigation = navigation("cursor2"),
            expectedSessionIncarnation = incarnation, expectedCursor = "cursor1") }
        unavailable { inbox.navigationFor(incarnation) }
        val restored = PersistentCiphertextInbox(store.restarted(), "device-1")
        assertEquals("cursor1", restored.navigationFor(incarnation)?.nextCursor)
        assertEquals(1, restored.pendingAcknowledgements(scope).size)
    }

    @Test fun `one-shot failed page flush restores prior snapshot for same-process retry`() {
        val store = InboxBacking()
        val inbox = PersistentCiphertextInbox(store, "device-1")
        inbox.capture(scope, listOf(wire()), navigation = navigation("cursor1"),
            expectedSessionIncarnation = incarnation)
        val priorSnapshot = store.values.toMap()

        // The first write mutates the store's cache, then its durability barrier
        // fails. The rollback barrier succeeds and restores the prior page.
        store.failOnFlushNumber = store.flushCalls + 1
        unavailable {
            inbox.capture(scope, listOf(wire("message-2")), navigation = navigation("cursor2"),
                expectedSessionIncarnation = incarnation, expectedCursor = "cursor1")
        }
        assertEquals(priorSnapshot, store.values)
        assertEquals("cursor1", inbox.navigationFor(incarnation)?.nextCursor)
        assertEquals(listOf("message-1"), inbox.pendingCrypto(scope).map { it.messageId })

        // Retry the exact page from the durable prior cursor; it is accepted
        // and both rows and the next cursor become durable together.
        inbox.capture(scope, listOf(wire("message-2")), navigation = navigation("cursor2"),
            expectedSessionIncarnation = incarnation, expectedCursor = "cursor1")
        val restored = PersistentCiphertextInbox(store.restarted(), "device-1")
        assertEquals("cursor2", restored.navigationFor(incarnation)?.nextCursor)
        assertEquals(listOf("message-1", "message-2"), restored.pendingCrypto(scope).map { it.messageId })
    }

    @Test fun `failed rollback mutation poisons snapshot for every inbox wrapper`() {
        val store = InboxBacking()
        val inbox = PersistentCiphertextInbox(store, "device-1")
        inbox.capture(scope, listOf(wire()), navigation = navigation("cursor1"),
            expectedSessionIncarnation = incarnation)

        // The attempted page mutates the cache, its flush fails, and restoring
        // the prior snapshot also fails before it can replace the cached value.
        store.failOnFlushNumber = store.flushCalls + 1
        store.failOnPutNumber = store.putCalls + 2
        unavailable {
            inbox.capture(scope, listOf(wire("message-2")), navigation = navigation("cursor2"),
                expectedSessionIncarnation = incarnation, expectedCursor = "cursor1")
        }
        assertEquals(listOf("message-1", "message-2"),
            JSONObject(store.values.values.single()).getJSONArray("records").let { records ->
                (0 until records.length()).map { records.getJSONObject(it).getString("messageId") }
            })

        unavailable { inbox.pendingAcknowledgements(scope) }
        unavailable { inbox.navigationFor(incarnation) }
        unavailable { PersistentCiphertextInbox(store, "device-1").pendingCrypto(scope) }
        unavailable {
            inbox.capture(scope, listOf(wire("message-2")), navigation = navigation("cursor2"),
                expectedSessionIncarnation = incarnation, expectedCursor = "cursor1")
        }
    }

    @Test fun `failed rollback flush poisons even when cache appears restored`() {
        val store = InboxBacking()
        val inbox = PersistentCiphertextInbox(store, "device-1")
        inbox.capture(scope, listOf(wire()), navigation = navigation("cursor1"),
            expectedSessionIncarnation = incarnation)
        val priorSnapshot = store.values.toMap()
        store.failOnFlushNumbers = setOf(store.flushCalls + 1, store.flushCalls + 2)

        unavailable {
            inbox.capture(scope, listOf(wire("message-2")), navigation = navigation("cursor2"),
                expectedSessionIncarnation = incarnation, expectedCursor = "cursor1")
        }
        // The cache has the old snapshot, but the failed rollback barrier means
        // its durability cannot be proven. Do not expose it as committed state.
        assertEquals(priorSnapshot, store.values)
        unavailable { inbox.pendingAcknowledgements(scope) }
        unavailable { PersistentCiphertextInbox(store, "device-1").navigationFor(incarnation) }
    }

    @Test fun `wrong session repeated cursor and stale request cannot advance custody`() {
        val store = InboxBacking()
        val inbox = PersistentCiphertextInbox(store, "device-1")
        inbox.capture(scope, listOf(wire()), navigation = navigation("cursor1"),
            expectedSessionIncarnation = incarnation)
        val before = store.values.toMap()
        unavailable { inbox.capture(scope, emptyList(), navigation = navigation("cursor1"),
            expectedSessionIncarnation = incarnation, expectedCursor = "cursor1") }
        unavailable { inbox.capture(scope, emptyList(), navigation = navigation("cursor2"),
            expectedSessionIncarnation = incarnation, expectedCursor = "stale") }
        unavailable { inbox.capture(scope, emptyList(), navigation = navigation("cursor2"),
            expectedSessionIncarnation = "b".repeat(64), expectedCursor = "cursor1") }
        assertEquals(before, store.values)
    }

    @Test fun `malformed cursor state is rejected without replacing retained cursor or ciphertext`() {
        val store = InboxBacking()
        val inbox = PersistentCiphertextInbox(store, "device-1")
        inbox.capture(scope, listOf(wire()), navigation = navigation("cursor1"),
            expectedSessionIncarnation = incarnation)
        val before = store.values.toMap()

        // The transport model rejects malformed navigation at construction;
        // the persistence boundary independently rejects a malformed caller session.
        unavailable { inbox.capture(scope, emptyList(), navigation = navigation("cursor2"),
            expectedSessionIncarnation = "invalid", expectedCursor = "cursor1") }
        assertEquals(before, store.values)

        val invalidSessionStore = InboxBacking()
        unavailable {
            PersistentCiphertextInbox(invalidSessionStore, "device-1").capture(
                scope, emptyList(), navigation = navigation("cursor1"),
                expectedSessionIncarnation = "invalid",
            )
        }
        assertTrue(invalidSessionStore.values.isEmpty())
    }

    @Test fun `persisted malformed cursor state remains unavailable instead of being reset`() {
        val corruptions: List<(JSONObject) -> Unit> = listOf(
            { it.put("hasMore", false) },
            { it.put("nextCursor", JSONObject.NULL) },
            { it.put("nextCursor", "cursor/with/slash") },
            { it.put("nextCursor", "x".repeat(org.pca.app.runtime.sync.transport.MAX_INBOUND_CURSOR_LENGTH + 1)) },
            { it.put("sessionIncarnation", "invalid") },
        )
        corruptions.forEach { corruptNavigation ->
            val store = InboxBacking()
            PersistentCiphertextInbox(store, "device-1").capture(scope, listOf(wire()),
                navigation = navigation("cursor1"), expectedSessionIncarnation = incarnation)
            val key = store.values.keys.single()
            val corrupted = JSONObject(store.values.getValue(key))
            corruptNavigation(corrupted.getJSONObject("navigation"))
            store.values[key] = corrupted.toString()

            unavailable { PersistentCiphertextInbox(store, "device-1").navigationFor(incarnation) }

            assertEquals(corrupted.toString(), store.values[key])
        }
    }

    @Test fun `ambiguous persisted inbox members fail closed without rewriting snapshot`() {
        val store = InboxBacking()
        val inbox = PersistentCiphertextInbox(store, "device-1")
        inbox.capture(scope, listOf(wire()), navigation = navigation("cursor1"),
            expectedSessionIncarnation = incarnation)
        val key = store.values.keys.single()
        val valid = store.values.getValue(key)
        val ambiguous = valid.replace("\"version\":2", "\"version\":2,\"version\":1")
            .replace("\"messageId\":\"message-1\"", "\"messageId\":\"message-1\",\"messageId\":\"other\"")
        assertNotEquals(valid, ambiguous)
        store.values[key] = ambiguous

        unavailable { inbox.pendingCrypto(scope) }

        assertEquals(ambiguous, store.values[key])
    }

    private val scope = RuntimeInboxScope("family-1", "device-1")
    @Test fun `legacy response to resumed modern cursor retains entire snapshot`() {
        val store = InboxBacking()
        val inbox = PersistentCiphertextInbox(store, "device-1")
        inbox.capture(scope, listOf(wire()), navigation = navigation("cursor1"),
            expectedSessionIncarnation = incarnation)
        val before = store.values.toMap()
        unavailable { inbox.capture(scope, listOf(wire("message-2")),
            expectedSessionIncarnation = incarnation, expectedCursor = "cursor1") }
        assertEquals(before, store.values)
        val restored = PersistentCiphertextInbox(store.restarted(), "device-1")
        assertEquals("cursor1", restored.navigationFor(incarnation)?.nextCursor)
        assertEquals(listOf("message-1"), restored.pendingAcknowledgements(scope).map { it.messageId })
        assertEquals(1, restored.pendingCryptoCount())
    }

    private fun wire(id: String = "message-1") = String(envelopeToRelayCiphertext(FamilyEnvelope(
        1, 0, id, "family-1", "sender-1", RecipientBinding.Device("device-1"), "key-1",
        "STATUS_SNAPSHOT", 1, 1, "nonce-1", 1_700_000_000_000L, 1_700_000_060_000L,
        "1.0.0", null, byteArrayOf(1, 2, 3), "signature-1",
    )), Charsets.UTF_8)

    @Test fun `inbox accepts an understood protocol minor at the JSON safe-integer maximum`() {
        val futureMinorWire = JSONObject(wire())
            .put("protocolMinor", 9_007_199_254_740_991L)
            .toString()
        val inbox = PersistentCiphertextInbox(InboxBacking(), "device-1")

        inbox.capture(scope, listOf(futureMinorWire))

        assertEquals(futureMinorWire, inbox.pendingAcknowledgements(scope).single().envelopeWire)
    }
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
        store.failOnFlushNumber = store.flushCalls + 1
        unavailable { inbox.capture(scope, listOf(wire())) }
        unavailable { inbox.pendingAcknowledgements(scope) }
        // A failed first commit is rolled back to the empty prior snapshot;
        // the relay can redeliver because no ACK or cursor was committed.
        unavailable { inbox.pendingAcknowledgements(scope) }
        inbox.capture(scope, listOf(wire()))
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
            "keyEpoch" to -1, "protocolMajor" to 1.5, "protocolMinor" to java.math.BigInteger("9007199254740992"), "payload" to "A!QID",
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
        // markAcknowledged confirms the current snapshot first, then writes
        // the marker. Fail that marker barrier once; the rollback barrier can
        // then durably restore the pending-ACK snapshot.
        store.failOnFlushNumber = store.flushCalls + 2
        unavailable { inbox.markAcknowledged(scope, "message-1", wire()) }
        assertEquals(1, inbox.pendingAcknowledgements(scope).size)
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
