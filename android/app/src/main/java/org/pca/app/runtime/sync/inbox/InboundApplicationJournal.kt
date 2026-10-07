package org.pca.app.runtime.sync.inbox

import java.util.Base64
import java.util.UUID
import java.util.IdentityHashMap
import kotlinx.coroutines.sync.Mutex
import org.json.JSONArray
import org.json.JSONObject
import org.pca.app.foundation.PersistentStateStore

/** A prepared intent is recovery state, never proof that a command took effect. */
data class InboundApplicationIntent(
    val operationId: String,
    val scope: RuntimeInboxScope,
    val messageId: String,
    val envelopeWire: String,
    val authorityBinding: String,
    val commandBinding: String,
    val preparedAtEpochMillis: Long,
)

enum class InboundApplicationOutcome { APPLIED, REJECTED }

data class InboundApplicationRecord(
    val intent: InboundApplicationIntent,
    val outcome: InboundApplicationOutcome? = null,
    val completedAtEpochMillis: Long? = null,
)

class InboundApplicationJournalUnavailable : Exception("Application journal unavailable")

/** Separate from ciphertext custody and relay ACKs; no receipt eviction without replay protection. */
class PersistentInboundApplicationJournal(
    private val store: PersistentStateStore,
    private val expectedDeviceId: String,
    private val maxRecords: Int = 64,
    private val maxSnapshotBytes: Int = 1024 * 1024,
) {
    /** All consumers/retirement coordinators using this device store share admission serialization. */
    private val coordinationLock: Any = store.coordinationLock
    internal val operationMutex: Mutex = synchronized(coordinatorRegistry) {
        coordinatorRegistry.getOrPut(coordinationLock) { mutableMapOf() }.getOrPut(expectedDeviceId) { Mutex() }
    }
    private val storageKey = "runtime.inbound-application.v1." +
        Base64.getUrlEncoder().withoutPadding().encodeToString(expectedDeviceId.toByteArray(Charsets.UTF_8))
    private val retirementRequiredKey = storageKey + ".retirement-required"
    private val retirementRequiredValue = "v1:$expectedDeviceId"
    private data class Snapshot(val records: List<InboundApplicationRecord>, val cursor: String?, val retirementRequired: Boolean = false)

    init {
        require(expectedDeviceId.isNotBlank() && expectedDeviceId.length <= 128)
        require(maxRecords in 1..64 && maxSnapshotBytes in 1..1024 * 1024)
    }

    fun records(): List<InboundApplicationRecord> = synchronized(coordinationLock) {
        val snapshot = read()
        persist(snapshot)
        snapshot.records.toList()
    }

    /** Irreversibly latch denial consultation before the first retirement mutation. */
    internal fun requireReplayDenial() = synchronized(coordinationLock) {
        try {
            val marker = store.getString(retirementRequiredKey)
            if (marker != null && marker != retirementRequiredValue) unavailable()
            if (marker == null && store.contains(retirementRequiredKey)) unavailable()
            if (marker == null) {
                store.putString(retirementRequiredKey, retirementRequiredValue)
                store.flush()
                if (store.getString(retirementRequiredKey) != retirementRequiredValue) unavailable()
            }
            val snapshot = read()
            if (!snapshot.retirementRequired) persist(snapshot.copy(retirementRequired = true))
        } catch (_: Exception) { unavailable() }
    }

    /** Every old and future consumer must honor this latch, even if built with the old nil default. */
    internal fun assertReplayDenialConfiguration(scope: RuntimeInboxScope, denial: PersistentInboundReplayDenialLedger?) = synchronized(coordinationLock) {
        val marker = try { store.getString(retirementRequiredKey) } catch (_: Exception) { unavailable() }
        if (marker == null && store.contains(retirementRequiredKey)) unavailable()
        val snapshot = read()
        if (snapshot.retirementRequired && marker != retirementRequiredValue) unavailable()
        if (marker != null) {
            if (marker != retirementRequiredValue || denial == null || !denial.matchesJournal(this)) unavailable()
            if (denial.boundaries().none { it.scope == scope }) unavailable()
        }
        if (denial != null) {
            if (!denial.matchesJournal(this)) unavailable()
            denial.boundaries()
        }
    }

    fun processingCursor(): String? = synchronized(coordinationLock) {
        val snapshot = read()
        persist(snapshot)
        snapshot.cursor
    }

    fun advanceProcessingCursor(scope: RuntimeInboxScope, messageId: String) = synchronized(coordinationLock) {
        persist(read().copy(cursor = identity(scope, messageId)))
    }

    fun prepare(intent: InboundApplicationIntent): InboundApplicationRecord = synchronized(coordinationLock) {
        validate(intent)
        val snapshot = read()
        val prior = snapshot.records.find { identity(it.intent.scope, it.intent.messageId) == identity(intent.scope, intent.messageId) }
        if (prior != null) {
            if (prior.intent != intent) unavailable()
            persist(snapshot)
            return@synchronized prior
        }
        if (snapshot.records.size >= maxRecords || snapshot.records.any { it.intent.operationId == intent.operationId }) unavailable()
        val record = InboundApplicationRecord(intent)
        persist(snapshot.copy(records = snapshot.records + record))
        record
    }

    fun complete(intent: InboundApplicationIntent, outcome: InboundApplicationOutcome, atEpochMillis: Long): InboundApplicationRecord = synchronized(coordinationLock) {
        validate(intent)
        if (atEpochMillis < intent.preparedAtEpochMillis) unavailable()
        val snapshot = read()
        val index = snapshot.records.indexOfFirst { it.intent.operationId == intent.operationId }
        if (index < 0) unavailable()
        val prior = snapshot.records[index]
        if (prior.intent != intent || (prior.outcome != null && prior.outcome != outcome)) unavailable()
        val completed = if (prior.outcome != null) prior else prior.copy(outcome = outcome, completedAtEpochMillis = atEpochMillis)
        persist(snapshot.copy(records = snapshot.records.mapIndexed { position, record -> if (position == index) completed else record }))
        completed
    }

    internal fun matchesBacking(other: PersistentStateStore, deviceId: String): Boolean =
        coordinationLock === other.coordinationLock && expectedDeviceId == deviceId

    /** Only the serialized verified retirement path may remove an exact terminal record. */
    internal fun removeRetiredTerminal(expected: InboundApplicationRecord, assertPermanentCoverage: () -> Unit): Boolean = synchronized(coordinationLock) {
        validate(expected.intent)
        if (expected.outcome == null || expected.completedAtEpochMillis == null || expected.completedAtEpochMillis < expected.intent.preparedAtEpochMillis) unavailable()
        val snapshot = read()
        val prior = snapshot.records.find { it.intent.operationId == expected.intent.operationId }
        if (prior != null && prior != expected) unavailable()
        assertPermanentCoverage()
        persist(snapshot.copy(records = snapshot.records.filterNot { it.intent.operationId == expected.intent.operationId }))
        prior != null
    }

    fun identity(scope: RuntimeInboxScope, messageId: String): String {
        if (scope.recipientDeviceId != expectedDeviceId || messageId.isEmpty() || messageId.length > 128) unavailable()
        return JSONArray().put(scope.familyId).put(scope.recipientDeviceId).put(messageId).toString()
    }

    private fun validate(intent: InboundApplicationIntent) {
        try {
            if (UUID.fromString(intent.operationId).toString() != intent.operationId) unavailable()
            identity(intent.scope, intent.messageId)
            if (intent.preparedAtEpochMillis < 0 || intent.envelopeWire.toByteArray(Charsets.UTF_8).size > 256 * 1024) unavailable()
            for (binding in listOf(intent.authorityBinding, intent.commandBinding)) {
                val decoded = Base64.getDecoder().decode(binding)
                if (decoded.size !in 1..8192 || Base64.getEncoder().encodeToString(decoded) != binding) unavailable()
            }
            val envelope = PersistentCiphertextInbox.validateEnvelope(intent.envelopeWire, intent.scope)
            if (envelope.messageId != intent.messageId) unavailable()
        } catch (_: Exception) { unavailable() }
    }

    private fun read(): Snapshot {
        try {
            val raw = store.getString(storageKey) ?: run {
                if (store.contains(storageKey)) unavailable()
                return Snapshot(emptyList(), null)
            }
            if (raw.toByteArray(Charsets.UTF_8).size > maxSnapshotBytes) unavailable()
            val json = JSONObject(raw)
            if (json.get("version") != 1) unavailable()
            val array = json.getJSONArray("records")
            if (array.length() > maxRecords) unavailable()
            val operationIds = HashSet<String>()
            val identities = HashSet<String>()
            val records = (0 until array.length()).map { index ->
                val item = array.getJSONObject(index)
                fun string(key: String): String = (item.get(key) as? String) ?: unavailable()
                fun millis(key: String): Long {
                    val value = item.get(key)
                    if (value !is Long && value !is Int) unavailable()
                    return (value as Number).toLong()
                }
                val intent = InboundApplicationIntent(string("operationId"), RuntimeInboxScope(string("familyId"), string("recipientDeviceId")),
                    string("messageId"), string("envelopeWire"), string("authorityBinding"), string("commandBinding"), millis("preparedAt"))
                validate(intent)
                if (!operationIds.add(intent.operationId) || !identities.add(identity(intent.scope, intent.messageId))) unavailable()
                if (!item.has("outcome") || !item.has("completedAt")) unavailable()
                val outcome = if (item.isNull("outcome")) null else InboundApplicationOutcome.valueOf(string("outcome"))
                val completedAt = if (item.isNull("completedAt")) null else millis("completedAt")
                if ((outcome == null) != (completedAt == null) || (completedAt != null && completedAt < intent.preparedAtEpochMillis)) unavailable()
                InboundApplicationRecord(intent, outcome, completedAt)
            }
            if (!json.has("cursor")) unavailable()
            val retirementRequired = if (json.has("retirementRequired")) (json.get("retirementRequired") as? Boolean) ?: unavailable() else false
            val cursor = if (json.isNull("cursor")) null else (json.get("cursor") as? String) ?: unavailable()
            if (cursor != null) {
                if (cursor.toByteArray(Charsets.UTF_8).size > 4096) unavailable()
                val values = JSONArray(cursor)
                if (values.length() != 3 || (0..2).any { values.get(it) !is String }) unavailable()
                if (identity(RuntimeInboxScope(values.getString(0), values.getString(1)), values.getString(2)) != cursor) unavailable()
            }
            return Snapshot(records, cursor, retirementRequired)
        } catch (_: Exception) { unavailable() }
    }

    private fun persist(snapshot: Snapshot) {
        try {
            val records = JSONArray()
            snapshot.records.forEach { record ->
                val intent = record.intent
                records.put(JSONObject().put("operationId", intent.operationId).put("familyId", intent.scope.familyId)
                    .put("recipientDeviceId", intent.scope.recipientDeviceId).put("messageId", intent.messageId)
                    .put("envelopeWire", intent.envelopeWire).put("authorityBinding", intent.authorityBinding)
                    .put("commandBinding", intent.commandBinding).put("preparedAt", intent.preparedAtEpochMillis)
                    .put("outcome", record.outcome?.name ?: JSONObject.NULL)
                    .put("completedAt", record.completedAtEpochMillis ?: JSONObject.NULL))
            }
            val raw = JSONObject().put("version", 1).put("records", records).put("cursor", snapshot.cursor ?: JSONObject.NULL)
                .put("retirementRequired", snapshot.retirementRequired).toString()
            if (raw.toByteArray(Charsets.UTF_8).size > maxSnapshotBytes) unavailable()
            store.putString(storageKey, raw)
            store.flush()
            if (store.getString(storageKey) != raw) unavailable()
        } catch (_: Exception) { unavailable() }
    }

    private fun unavailable(): Nothing = throw InboundApplicationJournalUnavailable()

    private companion object {
        // Production owns a process-lifetime store. Identity, not store value equality, selects its lock.
        val coordinatorRegistry = IdentityHashMap<Any, MutableMap<String, Mutex>>()
    }
}
