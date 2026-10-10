package org.pca.app.runtime.child

import android.util.Base64
import java.security.MessageDigest
import java.nio.charset.CodingErrorAction
import java.nio.charset.CharacterCodingException
import java.util.WeakHashMap
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
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

/** A request id already binds a different immutable child-request payload. */
class ChildRequestIdentityConflict : IllegalStateException("Child request identity conflict")

/** Process-local flush serialization shared by wrappers over the same persistent store. */
private object ChildRequestFlushLocks {
    private val locks = WeakHashMap<Any, Mutex>()

    fun forStore(coordinationLock: Any): Mutex = synchronized(locks) {
        locks.getOrPut(coordinationLock) { Mutex() }
    }
}

/** A failed rollback makes the queue unreadable for this process, even through a new wrapper. */
private object ChildRequestQueueHealth {
    private val poisonedKeys = WeakHashMap<Any, MutableSet<String>>()

    fun isPoisoned(coordinationLock: Any, key: String): Boolean = synchronized(poisonedKeys) {
        key in poisonedKeys[coordinationLock].orEmpty()
    }

    fun poison(coordinationLock: Any, key: String) = synchronized(poisonedKeys) {
        poisonedKeys.getOrPut(coordinationLock) { mutableSetOf() }.add(key)
    }
}

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
    // Hold across the suspending transport call so another wrapper cannot submit the same pending
    // identity while the first result is still unknown.
    private val flushMutex = ChildRequestFlushLocks.forStore(lock)

    /** Enqueues a new child request locally. An exact replay by [ChildRequestPayload.requestId] is
     * idempotent; reuse of that identity for different immutable content is rejected. */
    fun enqueue(payload: ChildRequestPayload): ChildRequestQueueEntry = synchronized(lock) {
        requireValidPayload(payload)
        val existing = readAll().toMutableList()
        val already = existing.firstOrNull { it.payload.requestId == payload.requestId }
        if (already != null) {
            if (already.payload != payload) throw ChildRequestIdentityConflict()
            return already
        }

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
        return flushMutex.withLock {
            if (port.currentConnectionState() != FamilySyncConnectionState.LIVE) return@withLock 0
            var submittedCount = 0
            for (entry in pending()) {
                // submitChildRequest is suspending: the family channel may become stale or
                // disconnect while a prior request is in flight. The port contract requires
                // LIVE at each invocation, so the initial check alone is not sufficient.
                if (port.currentConnectionState() != FamilySyncConnectionState.LIVE) break
                if (port.submitChildRequest(entry.payload)) {
                    markSubmitted(entry.payload.requestId)
                    submittedCount++
                }
            }
            submittedCount
        }
    }

    private fun readAll(): List<ChildRequestQueueEntry> {
        if (ChildRequestQueueHealth.isPoisoned(lock, key)) unavailable()
        val raw = try {
            recoverPendingWrite()
            store.getString(key)
        } catch (_: ChildRequestQueueUnavailable) {
            throw ChildRequestQueueUnavailable()
        } catch (_: Exception) {
            unavailable()
        } ?: return emptyList()
        if (raw.isEmpty()) return emptyList()
        val entries = raw.split(RECORD_SEPARATOR).map(::decode)
        val requestIds = HashSet<String>(entries.size)
        if (entries.any { !requestIds.add(it.payload.requestId) }) unavailable()
        return entries
    }

    private fun writeAll(entries: List<ChildRequestQueueEntry>) {
        if (ChildRequestQueueHealth.isPoisoned(lock, key)) unavailable()
        val pendingKey = pendingWriteKey
        val previous = try {
            if (store.getString(pendingKey) != null) unavailable()
            store.getString(key)
        } catch (_: Exception) {
            unavailable()
        }
        val candidate = entries.joinToString(RECORD_SEPARATOR, transform = ::encode)
        val persistedCandidate = candidate.ifEmpty { null }
        val writeMarker = encodePendingWrite(previous, persistedCandidate)
        var candidateMayHaveChanged = false
        try {
            // SharedPreferences.apply() is asynchronous. Persist a descriptor of the exact prior
            // and candidate snapshots first. After process death, only one of those two exact
            // byte snapshots is eligible for recovery; unknown states remain fail-closed.
            store.putString(pendingKey, writeMarker)
            store.flush()
            check(store.getString(pendingKey) == writeMarker)

            candidateMayHaveChanged = true
            if (persistedCandidate == null) store.remove(key) else store.putString(key, persistedCandidate)
            store.flush()
            check(store.getString(key) == persistedCandidate)

            store.remove(pendingKey)
            store.flush()
            check(store.getString(pendingKey) == null)
        } catch (_: Exception) {
            val restored = runCatching {
                if (candidateMayHaveChanged) {
                    if (previous == null) store.remove(key) else store.putString(key, previous)
                    store.flush()
                    check(store.getString(key) == previous)
                }
                store.remove(pendingKey)
                store.flush()
                check(store.getString(pendingKey) == null)
            }.isSuccess
            if (!restored) ChildRequestQueueHealth.poison(lock, key)
            throw ChildRequestQueueUnavailable()
        }
    }

    /** Clears a write marker only when storage is byte-for-byte one of the recorded transaction
     * endpoints. Legacy markers and any unknown/malformed state are preserved and fail closed. */
    private fun recoverPendingWrite() {
        val marker = store.getString(pendingWriteKey) ?: return
        val descriptor = decodePendingWrite(marker) ?: unavailable()
        val snapshot = store.getString(key)
        val fingerprint = snapshotFingerprint(snapshot)
        if (fingerprint != descriptor.previousFingerprint && fingerprint != descriptor.candidateFingerprint) {
            unavailable()
        }
        try {
            check(store.getString(pendingWriteKey) == marker)
            store.remove(pendingWriteKey)
            store.flush()
            check(store.getString(pendingWriteKey) == null)
        } catch (_: Exception) {
            unavailable()
        }
    }

    private data class PendingWriteDescriptor(
        val previousFingerprint: String,
        val candidateFingerprint: String,
    )

    private fun encodePendingWrite(previous: String?, candidate: String?): String = listOf(
        PENDING_WRITE_V2,
        snapshotFingerprint(previous),
        snapshotFingerprint(candidate),
    ).joinToString(MARKER_SEPARATOR)

    private fun decodePendingWrite(marker: String): PendingWriteDescriptor? {
        val parts = marker.split(MARKER_SEPARATOR)
        if (parts.size != 3 || parts[0] != PENDING_WRITE_V2) return null
        if (!isSnapshotFingerprint(parts[1]) || !isSnapshotFingerprint(parts[2])) return null
        return PendingWriteDescriptor(parts[1], parts[2])
    }

    /** `absent` is distinct from the SHA-256 fingerprint of a present empty snapshot. */
    private fun snapshotFingerprint(snapshot: String?): String {
        if (snapshot == null) return ABSENT_SNAPSHOT
        val digest = MessageDigest.getInstance("SHA-256").digest(snapshot.toByteArray(Charsets.UTF_8))
        val hex = buildString(digest.size * 2) {
            for (byte in digest) {
                val value = byte.toInt() and 0xff
                append(HEX_DIGITS[value ushr 4])
                append(HEX_DIGITS[value and 0x0f])
            }
        }
        return "$PRESENT_SNAPSHOT_PREFIX$hex"
    }

    private fun isSnapshotFingerprint(value: String): Boolean =
        value == ABSENT_SNAPSHOT || (value.length == PRESENT_SNAPSHOT_PREFIX.length + SHA256_HEX_LENGTH &&
            value.startsWith(PRESENT_SNAPSHOT_PREFIX) && value.substring(PRESENT_SNAPSHOT_PREFIX.length).all {
                it in '0'..'9' || it in 'a'..'f'
            })

    private val pendingWriteKey: String get() = "$key.pending_write"

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
        const val MARKER_SEPARATOR = "|"
        const val PENDING_WRITE_V2 = "child-request-queue-write-v2"
        const val ABSENT_SNAPSHOT = "absent"
        const val PRESENT_SNAPSHOT_PREFIX = "sha256:"
        const val SHA256_HEX_LENGTH = 64
        const val HEX_DIGITS = "0123456789abcdef"
    }
}
