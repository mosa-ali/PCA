package org.pca.app.runtime.child

import android.util.Base64
import java.nio.charset.CodingErrorAction
import java.nio.charset.CharacterCodingException
import org.pca.app.foundation.PersistentStateStore
import org.pca.app.runtime.port.ChildRequestPayload
import org.pca.app.runtime.port.FamilySyncConnectionState
import org.pca.app.runtime.port.FamilySyncRuntimePort

/**
 * Task Section 12: allow eligible child request creation while fully offline. A queued request is
 * durable (survives process death / reboot -- Section 14) and stays in the conceptual
 * [ChildRequestLocalStatus.PENDING_SYNC_LOCAL] state until the sync runtime reports
 * [FamilySyncConnectionState.LIVE], at which point it is handed to [FamilySyncRuntimePort] through
 * the authorized family message flow -- this class never talks to any transport itself, and the
 * child can never self-approve a request by creating it (creation only ever produces a PENDING
 * entry; approval is exclusively a remote, parent-side action this device has no path to fake).
 */
enum class ChildRequestLocalStatus { PENDING_SYNC_LOCAL, SUBMITTED }

/** The durable child-request queue is corrupt or unavailable; callers must not rewrite its bytes. */
class ChildRequestQueueUnavailable : IllegalStateException("Child request queue unavailable")

data class ChildRequestQueueEntry(
    val payload: ChildRequestPayload,
    val status: ChildRequestLocalStatus,
)

class ChildRequestOfflineQueue(
    private val store: PersistentStateStore,
    private val key: String = KEY,
) {
    // Multiple queue wrappers can be created over one persistent store (for example across
    // independently composed UI/runtime components). Serialize each read-modify-write against
    // the backing store's shared lock so concurrent enqueue/submit transitions cannot lose rows.
    private val lock = store.coordinationLock

    /** Enqueues a new child request locally. Idempotent by [ChildRequestPayload.requestId] -- a
     * duplicate create attempt (e.g. a retried UI tap) never produces a second queued entry. */
    fun enqueue(payload: ChildRequestPayload): ChildRequestQueueEntry = synchronized(lock) {
        requireValidPayload(payload)
        val existing = readAll().toMutableList()
        val already = existing.firstOrNull { it.payload.requestId == payload.requestId }
        if (already != null) return already

        val entry = ChildRequestQueueEntry(payload, ChildRequestLocalStatus.PENDING_SYNC_LOCAL)
        existing += entry
        writeAll(existing)
        entry
    }

    fun pending(): List<ChildRequestQueueEntry> = synchronized(lock) {
        readAll().filter { it.status == ChildRequestLocalStatus.PENDING_SYNC_LOCAL }
    }

    fun outboxPendingCount(): Int = pending().size

    private fun markSubmitted(requestId: String) = synchronized(lock) {
        val updated = readAll().map {
            if (it.payload.requestId == requestId) it.copy(status = ChildRequestLocalStatus.SUBMITTED) else it
        }
        writeAll(updated)
    }

    /**
     * Attempts to flush every [ChildRequestLocalStatus.PENDING_SYNC_LOCAL] entry through [port].
     * A no-op (returns 0, touches nothing) unless [port] currently reports
     * [FamilySyncConnectionState.LIVE] -- Section 9's "a connected socket is not LIVE" invariant
     * means this must check the port's own state, never infer readiness from having been called.
     * Safe to call repeatedly (e.g. on every connectivity flap) -- entries already marked
     * [ChildRequestLocalStatus.SUBMITTED] are never resubmitted.
     */
    suspend fun flush(port: FamilySyncRuntimePort): Int {
        if (port.currentConnectionState() != FamilySyncConnectionState.LIVE) return 0
        var submittedCount = 0
        for (entry in pending()) {
            if (port.submitChildRequest(entry.payload)) {
                markSubmitted(entry.payload.requestId)
                submittedCount++
            }
        }
        return submittedCount
    }

    private fun readAll(): List<ChildRequestQueueEntry> {
        val raw = store.getString(key) ?: return emptyList()
        if (raw.isEmpty()) return emptyList()
        val entries = raw.split(RECORD_SEPARATOR).map(::decode)
        val requestIds = HashSet<String>(entries.size)
        if (entries.any { !requestIds.add(it.payload.requestId) }) unavailable()
        return entries
    }

    private fun writeAll(entries: List<ChildRequestQueueEntry>) {
        store.putString(key, entries.joinToString(RECORD_SEPARATOR, transform = ::encode))
    }

    private fun encode(entry: ChildRequestQueueEntry): String {
        val p = entry.payload
        val fields = listOf(
            p.requestId,
            p.kind,
            Base64.encodeToString(p.detail.toByteArray(Charsets.UTF_8), Base64.NO_WRAP),
            p.createdAtEpochMillis.toString(),
            entry.status.name,
        )
        return fields.joinToString(FIELD_SEPARATOR)
    }

    private fun decode(raw: String): ChildRequestQueueEntry {
        val parts = raw.split(FIELD_SEPARATOR)
        if (parts.size != FIELD_COUNT) unavailable()
        val requestId = parts[0]
        val kind = parts[1]
        if (requestId.isBlank() || kind.isBlank() || requestId.any(::isRecordDelimiter) || kind.any(::isRecordDelimiter)) {
            unavailable()
        }
        val encodedDetail = parts[2]
        val detailBytes = try {
            Base64.decode(encodedDetail, Base64.NO_WRAP)
        } catch (_: IllegalArgumentException) {
            unavailable()
        }
        if (Base64.encodeToString(detailBytes, Base64.NO_WRAP) != encodedDetail) unavailable()
        val detail = try {
            Charsets.UTF_8.newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT)
                .decode(java.nio.ByteBuffer.wrap(detailBytes))
                .toString()
        } catch (_: CharacterCodingException) {
            unavailable()
        }
        val createdAt = parts[3].toLongOrNull() ?: unavailable()
        val status = ChildRequestLocalStatus.entries.firstOrNull { it.name == parts[4] } ?: unavailable()
        return ChildRequestQueueEntry(
            payload = ChildRequestPayload(requestId, kind, detail, createdAt),
            status = status,
        )
    }

    private fun isRecordDelimiter(char: Char): Boolean = char == FIELD_SEPARATOR.single() || char == RECORD_SEPARATOR.single()

    private fun requireValidPayload(payload: ChildRequestPayload) {
        require(payload.requestId.isNotBlank() && payload.requestId.none(::isRecordDelimiter)) { "invalid child request id" }
        require(payload.kind.isNotBlank() && payload.kind.none(::isRecordDelimiter)) { "invalid child request kind" }
    }

    private fun unavailable(): Nothing = throw ChildRequestQueueUnavailable()

    private companion object {
        const val KEY = "child_request_offline_queue_v1"
        const val FIELD_SEPARATOR = "|"
        const val RECORD_SEPARATOR = "\n"
        const val FIELD_COUNT = 5
    }
}
