package org.pca.app.runtime.sync.inbox

import java.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import org.pca.app.foundation.PersistentStateStore
import org.pca.app.runtime.sync.envelope.FamilyEnvelope
import org.pca.app.runtime.sync.envelope.RecipientBinding
import org.pca.app.runtime.sync.envelope.envelopeFromRelayCiphertext
import org.pca.app.runtime.sync.transport.InboundNavigation
import org.pca.app.runtime.sync.transport.InboundReceipt
import org.pca.app.runtime.sync.transport.InboundReceiptOutcome

data class RuntimeInboxScope(val familyId: String, val recipientDeviceId: String) {
    init {
        require(familyId.isNotBlank() && familyId.length <= 128)
        require(recipientDeviceId.isNotBlank() && recipientDeviceId.length <= 128)
    }
}

/** Acknowledgement is transport custody only. Every retained item awaits verified crypto dispatch. */
data class CiphertextInboxRecord(val messageId: String, val envelopeWire: String, val acknowledgementPending: Boolean)

class CiphertextInboxUnavailable : Exception("Ciphertext custody unavailable")

/**
 * One immutable authenticated scope per device-local snapshot. Production
 * must supply an encrypted durable store; this adapter has no transient or
 * plaintext fallback. No ciphertext is evicted, decrypted or marked applied.
 */
class PersistentCiphertextInbox(
    private val store: PersistentStateStore,
    private val expectedDeviceId: String,
    private val maxRecords: Int = 256,
    private val maxSnapshotBytes: Int = 4 * 1024 * 1024,
) {
    private val storageKey = "runtime.ciphertext-inbox.v1." +
        Base64.getUrlEncoder().withoutPadding().encodeToString(expectedDeviceId.toByteArray(Charsets.UTF_8))

    init {
        require(expectedDeviceId.isNotBlank() && expectedDeviceId.length <= 128)
        require(maxRecords > 0 && maxRecords <= 256)
        require(maxSnapshotBytes > 0 && maxSnapshotBytes <= 4 * 1024 * 1024)
    }

    private data class Snapshot(
        val scope: RuntimeInboxScope, val records: List<CiphertextInboxRecord>,
        val navigation: InboundNavigation? = null, val receipts: List<InboundReceipt> = emptyList(),
        val campaignUnresolved: Boolean = false,
    )

    /** Reset only navigation after reauthentication; retained ciphertext and ACK state survive. */
    fun navigationFor(sessionIncarnation: String): InboundNavigation? = synchronized(store) {
        require(Regex("^[0-9a-f]{64}$").matches(sessionIncarnation))
        val snapshot = readSnapshot() ?: return@synchronized null
        val navigation = snapshot.navigation ?: return@synchronized null
        if (navigation.sessionIncarnation == sessionIncarnation) {
            // A prior failed flush can leave only cached navigation advanced.
            persist(snapshot)
            return@synchronized navigation
        }
        persist(snapshot.copy(navigation = null))
        null
    }

    /** State reporting only; this read can never authorize acknowledgement. */
    fun pendingCryptoCount(): Int = synchronized(store) { readSnapshot()?.records?.size ?: 0 }

    /** Server rejection resets only the exact requested navigation, never custody or receipts. */
    fun resetRejectedNavigation(sessionIncarnation: String, cursor: String) = synchronized(store) {
        val snapshot = readSnapshot() ?: unavailable()
        val navigation = snapshot.navigation ?: unavailable()
        if (navigation.sessionIncarnation != sessionIncarnation || navigation.nextCursor != cursor) unavailable()
        persist(snapshot.copy(navigation = null))
    }

    fun hasUnresolvedRelayWork(): Boolean = synchronized(store) {
        val snapshot = readSnapshot()
        snapshot?.campaignUnresolved == true || snapshot?.navigation?.hasMore == true
    }

    /** Authenticated scope retained with ciphertext, never inferred from a new page. */
    fun retainedScope(): RuntimeInboxScope? = synchronized(store) {
        val snapshot = readSnapshot() ?: return@synchronized null
        persist(snapshot)
        snapshot.scope
    }

    /** Scope must come from the session-authenticated HTTP response, never ciphertext or QR data. */
    fun capture(
        scope: RuntimeInboxScope, envelopeWires: List<String>,
        receipts: List<InboundReceipt> = emptyList(), navigation: InboundNavigation? = null,
        expectedSessionIncarnation: String? = null, expectedCursor: String? = null,
    ): List<CiphertextInboxRecord> = synchronized(store) {
        checkScope(scope)
        val existing = readSnapshot()
        if (existing != null && existing.scope != scope) unavailable()
        if (envelopeWires.size > maxRecords) unavailable()
        if (receipts.size > 100 || receipts.map { it.messageId }.toSet().size != receipts.size) unavailable()
        if (navigation != null) {
            if (navigation.sessionIncarnation != expectedSessionIncarnation) unavailable()
            val prior = existing?.navigation
            val priorCursor = if (prior?.sessionIncarnation == expectedSessionIncarnation) prior.nextCursor else null
            if (priorCursor != expectedCursor || (navigation.hasMore && navigation.nextCursor == expectedCursor)) unavailable()
        } else if (expectedCursor != null) {
            // A resumed modern campaign cannot silently downgrade to a
            // legacy response and erase its durable continuation position.
            unavailable()
        }
        val records = (existing?.records ?: emptyList()).toMutableList()
        for (wire in envelopeWires) {
            val envelope = validateEnvelope(wire, scope)
            val prior = records.find { it.messageId == envelope.messageId }
            if (prior != null) {
                if (prior.envelopeWire != wire) unavailable()
            } else {
                if (records.size >= maxRecords) unavailable()
                records.add(CiphertextInboxRecord(envelope.messageId, wire, true))
            }
        }
        // Even identical redelivery repeats the durability barrier: a failed
        // prior flush may have changed only the backing store's memory cache.
        // Bounded recent receipt diagnostics may roll over; ciphertext never does.
        val refreshedIds = receipts.map { it.messageId }.toSet()
        val mergedReceipts = (existing?.receipts.orEmpty().filter { it.messageId !in refreshedIds } + receipts).takeLast(256)
        val continuing = expectedCursor != null
        val unresolved = receipts.any { it.outcome != InboundReceiptOutcome.APPLIED } ||
            (if (navigation == null) existing?.campaignUnresolved ?: false
            else navigation.hasUnresolved || (continuing && existing?.campaignUnresolved == true))
        persist(Snapshot(scope, records, navigation, mergedReceipts, unresolved))
        records.toList()
    }

    fun pendingAcknowledgements(scope: RuntimeInboxScope): List<CiphertextInboxRecord> = synchronized(store) {
        confirmedSnapshot(scope).records.filter { it.acknowledgementPending }
    }

    fun pendingCrypto(scope: RuntimeInboxScope): List<CiphertextInboxRecord> = synchronized(store) {
        confirmedSnapshot(scope).records.toList()
    }

    fun markAcknowledged(scope: RuntimeInboxScope, messageId: String, expectedEnvelopeWire: String) = synchronized(store) {
        val snapshot = confirmedSnapshot(scope)
        val expected = validateEnvelope(expectedEnvelopeWire, scope)
        val prior = snapshot.records.find { it.messageId == messageId } ?: unavailable()
        if (expected.messageId != messageId || prior.envelopeWire != expectedEnvelopeWire) unavailable()
        persist(snapshot.copy(records = snapshot.records.map {
            if (it.messageId == messageId) it.copy(acknowledgementPending = false) else it
        }))
    }

    private fun confirmedSnapshot(scope: RuntimeInboxScope): Snapshot {
        checkScope(scope)
        val snapshot = readSnapshot() ?: unavailable()
        if (snapshot.scope != scope) unavailable()
        // Validate durability again before exposing ack candidates.
        persist(snapshot)
        return snapshot
    }

    private fun checkScope(scope: RuntimeInboxScope) {
        if (scope.recipientDeviceId != expectedDeviceId) unavailable()
    }

    private fun readSnapshot(): Snapshot? {
        try {
            val raw = store.getString(storageKey)
            if (raw == null) {
                if (store.contains(storageKey)) unavailable()
                return null
            }
            if (raw.toByteArray(Charsets.UTF_8).size > maxSnapshotBytes) unavailable()
            val json = JSONObject(raw)
            val version = json.get("version")
            if (version != 1 && version != 2) unavailable()
            for (key in listOf("familyId", "recipientDeviceId")) if (json.get(key) !is String) unavailable()
            val scope = RuntimeInboxScope(json.getString("familyId"), json.getString("recipientDeviceId"))
            checkScope(scope)
            val array = json.getJSONArray("records")
            if (array.length() > maxRecords) unavailable()
            val seen = HashSet<String>()
            val records = (0 until array.length()).map { index ->
                val item = array.getJSONObject(index)
                for (key in listOf("processingState", "messageId", "envelopeWire")) if (item.get(key) !is String) unavailable()
                if (item.getString("processingState") != "PENDING_CRYPTO") unavailable()
                val id = item.getString("messageId")
                val wire = item.getString("envelopeWire")
                val envelope = validateEnvelope(wire, scope)
                if (envelope.messageId != id || !seen.add(id) || item.get("acknowledgementPending") !is Boolean) unavailable()
                CiphertextInboxRecord(id, wire, item.getBoolean("acknowledgementPending"))
            }
            if (version == 1) return Snapshot(scope, records)
            if (json.get("campaignUnresolved") !is Boolean) unavailable()
            if (!json.has("navigation")) unavailable()
            val navigation = if (json.isNull("navigation")) null else {
                val item = json.getJSONObject("navigation")
                if (!item.has("nextCursor")) unavailable()
                if (item.get("sessionIncarnation") !is String || item.get("hasMore") !is Boolean || item.get("hasUnresolved") !is Boolean) unavailable()
                val cursor = if (item.isNull("nextCursor")) null else {
                    if (item.get("nextCursor") !is String) unavailable()
                    item.getString("nextCursor")
                }
                InboundNavigation(cursor, item.getBoolean("hasMore"), item.getBoolean("hasUnresolved"), item.getString("sessionIncarnation"))
            }
            val receiptArray = json.getJSONArray("receipts")
            if (receiptArray.length() > 256) unavailable()
            val receiptIds = HashSet<String>()
            val receipts = (0 until receiptArray.length()).map { index ->
                val item = receiptArray.getJSONObject(index)
                for (key in listOf("messageId", "outcome", "atUtc")) if (item.get(key) !is String) unavailable()
                val receipt = InboundReceipt(item.getString("messageId"), InboundReceiptOutcome.valueOf(item.getString("outcome")), item.getString("atUtc"))
                if (!receiptIds.add(receipt.messageId)) unavailable()
                receipt
            }
            return Snapshot(scope, records, navigation, receipts, json.getBoolean("campaignUnresolved"))
        } catch (_: Exception) { unavailable() }
    }

    private fun persist(snapshot: Snapshot) {
        try {
            val array = JSONArray()
            snapshot.records.forEach { record ->
                array.put(JSONObject().put("messageId", record.messageId).put("envelopeWire", record.envelopeWire)
                    .put("processingState", "PENDING_CRYPTO").put("acknowledgementPending", record.acknowledgementPending))
            }
            val receiptArray = JSONArray()
            snapshot.receipts.forEach { receipt -> receiptArray.put(JSONObject().put("messageId", receipt.messageId)
                .put("outcome", receipt.outcome.name).put("atUtc", receipt.atUtc)) }
            val navigation = snapshot.navigation?.let { JSONObject().put("nextCursor", it.nextCursor ?: JSONObject.NULL)
                .put("hasMore", it.hasMore).put("hasUnresolved", it.hasUnresolved).put("sessionIncarnation", it.sessionIncarnation) }
            val raw = JSONObject().put("version", 2).put("familyId", snapshot.scope.familyId)
                .put("recipientDeviceId", snapshot.scope.recipientDeviceId).put("records", array)
                .put("navigation", navigation ?: JSONObject.NULL).put("receipts", receiptArray)
                .put("campaignUnresolved", snapshot.campaignUnresolved).toString()
            if (raw.toByteArray(Charsets.UTF_8).size > maxSnapshotBytes) unavailable()
            store.putString(storageKey, raw)
            store.flush()
            if (store.getString(storageKey) != raw) unavailable()
        } catch (_: Exception) { unavailable() }
    }

    private fun validateEnvelope(wire: String, scope: RuntimeInboxScope): FamilyEnvelope {
        try {
            if (wire.toByteArray(Charsets.UTF_8).size > 256 * 1024) unavailable()
            val json = JSONObject(wire)
            for (key in listOf("messageId", "familyId", "senderDeviceId", "recipientDeviceId", "senderKeyId", "messageType", "sequenceOrNonce", "issuedAt", "expiresAt", "semanticVersion", "payload", "signature")) {
                val value = json.get(key)
                if (value !is String || value.isEmpty()) unavailable()
            }
            for (key in listOf("messageId", "familyId", "senderDeviceId", "recipientDeviceId", "senderKeyId")) {
                if (json.getString(key).length > 128) unavailable()
            }
            for (key in listOf("protocolMajor", "protocolMinor")) {
                val value = json.get(key)
                if (value !is Number || value.toDouble() != value.toLong().toDouble() || value.toLong() !in 0..Int.MAX_VALUE.toLong()) unavailable()
            }
            if (json.getInt("protocolMajor") != 1 || (json.has("recipientGroup") && !json.isNull("recipientGroup"))) unavailable()
            if (json.getString("messageType") !in MESSAGE_TYPES) unavailable()
            if (json.getString("sequenceOrNonce").length > 128 || json.getString("signature").length > 512) unavailable()
            val version = json.getString("semanticVersion")
            if (version.length > 32 || !SEMANTIC_VERSION.matches(version)) unavailable()
            if (json.has("correlationId") && !json.isNull("correlationId")) {
                val correlation = json.get("correlationId")
                if (correlation !is String || correlation.isEmpty() || correlation.length > 128) unavailable()
            }
            val payload = json.getString("payload")
            val decoded = Base64.getDecoder().decode(payload)
            if (decoded.size !in 1..65536 || Base64.getEncoder().encodeToString(decoded) != payload) unavailable()
            val envelope = envelopeFromRelayCiphertext(wire.toByteArray(Charsets.UTF_8)) ?: unavailable()
            if (envelope.familyId != scope.familyId || envelope.recipient != RecipientBinding.Device(scope.recipientDeviceId)) unavailable()
            return envelope
        } catch (_: Exception) { unavailable() }
    }

    private fun unavailable(): Nothing = throw CiphertextInboxUnavailable()

    private companion object {
        val SEMANTIC_VERSION = Regex("(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)")
        val MESSAGE_TYPES = setOf("POLICY_UPDATE", "POLICY_RECEIPT", "STATUS_SNAPSHOT", "ACTIVITY_SUMMARY",
            "LOCATION_RESPONSE", "CHILD_REQUEST", "PARENT_DECISION", "TAMPER_ALERT", "RETENTION_DELETION_INSTRUCTION",
            "RETENTION_RECEIPT", "FTS_UPDATE", "KEY_ROTATION", "DEVICE_REVOKE", "RECOVERY_TRANSACTION", "SIGNED_ROLLBACK")
    }
}
