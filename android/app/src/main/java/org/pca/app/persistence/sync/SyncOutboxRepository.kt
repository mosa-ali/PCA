package org.pca.app.persistence.sync

import org.pca.app.persistence.crypto.LocalRecordCipher
import org.pca.app.persistence.crypto.decryptFromColumns
import org.pca.app.persistence.crypto.encryptToColumns
import org.pca.app.persistence.dao.SyncOutboxDao
import org.pca.app.persistence.entity.SyncOutboxRecordEntity
import org.pca.app.persistence.entity.SyncOutboxState

/**
 * PCA-RUNTIME-PERSIST-1 Section 13: local delivery-scheduling priority
 * only -- never a new wire message type. Lower [rank] is more urgent.
 * Ordering mirrors the lane brief's conceptual list exactly.
 */
enum class OutboxPriority(val rank: Int) {
    SECURITY_TRUST(0),
    POLICY_APPLICATION_RECEIPT(1),
    PARENT_CHILD_DECISION(2),
    CRITICAL_STATE(3),
    ACTIVITY_SUMMARY(4),
}

/**
 * PCA-RUNTIME-PERSIST-1 Section 12: enforceable bounds on the outbox so a
 * disconnected device cannot grow it without limit. [maxTotalRecords] and
 * [maxTotalBytes] bound the whole local database's outbox; [maxPerFamily]
 * additionally bounds one family's share of it (a single mis-behaving
 * family/producer must not starve every other family sharing this device).
 */
data class OutboxQueueBounds(
    val maxTotalRecords: Int = 2_000,
    val maxTotalBytes: Long = 8L * 1024 * 1024,
    val maxPerFamily: Int = 500,
)

/** Result of an [SyncOutboxRepository.enqueue] call -- distinguishes a bounded-queue rejection from ordinary idempotent no-ops. */
enum class EnqueueOutcome { ENQUEUED, ALREADY_QUEUED, COALESCED, REJECTED_QUEUE_FULL }

/**
 * doc 09 Section 5.1 / PCA-LOCAL-DB-1 Section 18, extended by
 * PCA-RUNTIME-PERSIST-1 Sections 12-14 with bounded storage, priority-aware
 * eviction, and aggregation/coalescing support. `envelopeCiphertext` is the
 * ALREADY E2EE-encrypted outbound envelope (opaque bytes from the family
 * key hierarchy, doc 09) -- this repository wraps it with a second,
 * local-at-rest [LocalRecordCipher] layer before it ever reaches Room, so a
 * copy of the local DB file alone is not sufficient to read a queued
 * message even before it leaves the device.
 *
 * When the queue is at [bounds], [enqueue] evicts the single least-urgent
 * (highest [OutboxPriority.rank]) pending row strictly less urgent than the
 * incoming message and makes room for it; if every pending row is already
 * at least as urgent as the incoming one, the new message is rejected
 * rather than evicting something equally or more important (Section 13: "a
 * full queue must not silently destroy important security/policy
 * messages").
 */
class SyncOutboxRepository(
    private val dao: SyncOutboxDao,
    private val cipher: LocalRecordCipher,
    private val bounds: OutboxQueueBounds = OutboxQueueBounds(),
) : OutboxSyncStorage {

    /** Returns [EnqueueOutcome.ENQUEUED]/[EnqueueOutcome.ALREADY_QUEUED]/[EnqueueOutcome.COALESCED] on success, [EnqueueOutcome.REJECTED_QUEUE_FULL] if bounds could not be satisfied without evicting an equally-or-more urgent message. */
    suspend fun enqueue(
        messageId: String,
        familyScope: String,
        recipientScope: String,
        envelopeCiphertextBase64: String,
        sequence: Long,
        expiresAtEpochMillis: Long,
        createdAtEpochMillis: Long,
        priority: OutboxPriority = OutboxPriority.PARENT_CHILD_DECISION,
        coalesceKey: String? = null,
    ): EnqueueOutcome {
        if (dao.getById(messageId) != null) return EnqueueOutcome.ALREADY_QUEUED

        val (enc, iv) = cipher.encryptToColumns(envelopeCiphertextBase64)

        if (coalesceKey != null) {
            val existing = dao.getByCoalesceKey(coalesceKey, SyncOutboxState.PENDING)
            if (existing != null) {
                dao.coalesceUpdate(existing.messageId, enc, iv, sequence, expiresAtEpochMillis)
                return EnqueueOutcome.COALESCED
            }
        }

        if (!makeRoomFor(priority, familyScope)) return EnqueueOutcome.REJECTED_QUEUE_FULL

        val rowId = dao.enqueue(
            SyncOutboxRecordEntity(
                messageId = messageId,
                familyScope = familyScope,
                recipientScope = recipientScope,
                envelopeCipherEnc = enc,
                envelopeCipherIv = iv,
                sequence = sequence,
                state = SyncOutboxState.PENDING,
                retryCount = 0,
                nextRetryAtEpochMillis = null,
                expiresAtEpochMillis = expiresAtEpochMillis,
                createdAtEpochMillis = createdAtEpochMillis,
                priority = priority.rank,
                coalesceKey = coalesceKey,
            ),
        )
        return if (rowId != -1L) EnqueueOutcome.ENQUEUED else EnqueueOutcome.ALREADY_QUEUED
    }

    /** Evicts at most one least-urgent row per bound that would otherwise be exceeded. Returns false if a bound remains exceeded and no eligible eviction candidate exists. */
    private suspend fun makeRoomFor(priority: OutboxPriority, familyScope: String): Boolean {
        while (dao.countByState(SyncOutboxState.PENDING) >= bounds.maxTotalRecords ||
            dao.totalCiphertextLengthByState(SyncOutboxState.PENDING) >= bounds.maxTotalBytes ||
            dao.countByFamilyAndState(familyScope, SyncOutboxState.PENDING) >= bounds.maxPerFamily
        ) {
            val candidate = dao.getLeastUrgentEvictionCandidate(SyncOutboxState.PENDING, priority.rank) ?: return false
            dao.deleteById(candidate.messageId)
        }
        return true
    }

    override suspend fun getReadyForDelivery(nowEpochMillis: Long): List<Pair<SyncOutboxRecordEntity, String>> =
        dao.getReadyForDelivery(SyncOutboxState.PENDING, nowEpochMillis).map {
            it to cipher.decryptFromColumns(it.envelopeCipherEnc, it.envelopeCipherIv)
        }

    override suspend fun markSent(messageId: String) {
        dao.updateState(messageId, SyncOutboxState.SENT)
    }

    override suspend fun markFailedForRetry(messageId: String, nextRetryAtEpochMillis: Long) {
        dao.markRetry(messageId, SyncOutboxState.PENDING, nextRetryAtEpochMillis)
    }

    override suspend fun acknowledgeAndRemove(messageId: String) {
        dao.deleteById(messageId)
    }

    override suspend fun deleteExpired(nowEpochMillis: Long): Int = dao.deleteExpired(nowEpochMillis)

    override suspend fun pendingCount(): Int = dao.countByState(SyncOutboxState.PENDING)

    override suspend fun pendingCountForFamily(familyScope: String): Int =
        dao.countByFamilyAndState(familyScope, SyncOutboxState.PENDING)

    override suspend fun pendingByteSize(): Long = dao.totalCiphertextLengthByState(SyncOutboxState.PENDING)
}
