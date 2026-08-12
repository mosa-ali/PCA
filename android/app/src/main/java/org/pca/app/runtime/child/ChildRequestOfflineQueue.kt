package org.pca.app.runtime.child

import android.util.Base64
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

data class ChildRequestQueueEntry(
    val payload: ChildRequestPayload,
    val status: ChildRequestLocalStatus,
)

class ChildRequestOfflineQueue(
    private val store: PersistentStateStore,
    private val key: String = KEY,
) {
    private val lock = Any()

    /** Enqueues a new child request locally. Idempotent by [ChildRequestPayload.requestId] -- a
     * duplicate create attempt (e.g. a retried UI tap) never produces a second queued entry. */
    fun enqueue(payload: ChildRequestPayload): ChildRequestQueueEntry = synchronized(lock) {
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
        return raw.split(RECORD_SEPARATOR).mapNotNull(::decode)
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

    private fun decode(raw: String): ChildRequestQueueEntry? {
        val parts = raw.split(FIELD_SEPARATOR)
        if (parts.size != FIELD_COUNT) return null
        return try {
            ChildRequestQueueEntry(
                payload = ChildRequestPayload(
                    requestId = parts[0],
                    kind = parts[1],
                    detail = String(Base64.decode(parts[2], Base64.NO_WRAP), Charsets.UTF_8),
                    createdAtEpochMillis = parts[3].toLong(),
                ),
                status = ChildRequestLocalStatus.valueOf(parts[4]),
            )
        } catch (_: IllegalArgumentException) {
            null
        }
    }

    private companion object {
        const val KEY = "child_request_offline_queue_v1"
        const val FIELD_SEPARATOR = "|"
        const val RECORD_SEPARATOR = "\n"
        const val FIELD_COUNT = 5
    }
}
