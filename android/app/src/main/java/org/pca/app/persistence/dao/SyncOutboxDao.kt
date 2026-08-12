package org.pca.app.persistence.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import org.pca.app.persistence.entity.SyncOutboxRecordEntity
import org.pca.app.persistence.entity.SyncOutboxState

@Dao
interface SyncOutboxDao {
    /** IGNORE: re-enqueuing the same messageId (e.g. retried caller) is a no-op, not a duplicate row. */
    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun enqueue(entity: SyncOutboxRecordEntity): Long

    @Query("SELECT * FROM sync_outbox_records WHERE messageId = :messageId")
    suspend fun getById(messageId: String): SyncOutboxRecordEntity?

    /** Priority-first, then sequence -- lower [org.pca.app.persistence.entity.SyncOutboxRecordEntity.priority] is more urgent (Section 13). */
    @Query(
        "SELECT * FROM sync_outbox_records WHERE state = :state " +
            "AND (nextRetryAtEpochMillis IS NULL OR nextRetryAtEpochMillis <= :nowEpochMillis) " +
            "ORDER BY priority ASC, sequence ASC",
    )
    suspend fun getReadyForDelivery(state: SyncOutboxState, nowEpochMillis: Long): List<SyncOutboxRecordEntity>

    @Query(
        "UPDATE sync_outbox_records SET state = :newState, retryCount = retryCount + 1, " +
            "nextRetryAtEpochMillis = :nextRetryAtEpochMillis WHERE messageId = :messageId",
    )
    suspend fun markRetry(messageId: String, newState: SyncOutboxState, nextRetryAtEpochMillis: Long?): Int

    @Query("UPDATE sync_outbox_records SET state = :newState WHERE messageId = :messageId")
    suspend fun updateState(messageId: String, newState: SyncOutboxState): Int

    /** Section 11: explicit acknowledgement/removal primitive, distinct from [updateState] (which keeps the row as history/state). */
    @Query("DELETE FROM sync_outbox_records WHERE messageId = :messageId")
    suspend fun deleteById(messageId: String): Int

    @Query("DELETE FROM sync_outbox_records WHERE expiresAtEpochMillis < :nowEpochMillis")
    suspend fun deleteExpired(nowEpochMillis: Long): Int

    @Query("DELETE FROM sync_outbox_records WHERE familyScope = :familyScope")
    suspend fun deleteAllForFamily(familyScope: String): Int

    @Query("SELECT COUNT(*) FROM sync_outbox_records")
    suspend fun count(): Int

    /** Section 11/12: pending-queue pressure metrics for Agent 16's reconnect/backoff decisions. */
    @Query("SELECT COUNT(*) FROM sync_outbox_records WHERE state = :state")
    suspend fun countByState(state: SyncOutboxState): Int

    @Query("SELECT COUNT(*) FROM sync_outbox_records WHERE familyScope = :familyScope AND state = :state")
    suspend fun countByFamilyAndState(familyScope: String, state: SyncOutboxState): Int

    /** Approximate ciphertext byte pressure (Section 12's "max total bytes where feasible") -- the local-at-rest ciphertext column is the closest on-disk proxy available without decrypting. */
    @Query("SELECT COALESCE(SUM(LENGTH(envelopeCipherEnc)), 0) FROM sync_outbox_records WHERE state = :state")
    suspend fun totalCiphertextLengthByState(state: SyncOutboxState): Long

    /** Section 12: eviction candidate when the queue is full -- the least-urgent (highest [priority] value), oldest-by-sequence row currently pending. Callers MUST only evict a row whose priority is strictly less urgent than the incoming one (Section 13: never silently destroy an important message to make room for a less important one). */
    @Query(
        "SELECT * FROM sync_outbox_records WHERE state = :state AND priority > :moreUrgentThan " +
            "ORDER BY priority DESC, sequence ASC LIMIT 1",
    )
    suspend fun getLeastUrgentEvictionCandidate(state: SyncOutboxState, moreUrgentThan: Int): SyncOutboxRecordEntity?

    /** Section 14: aggregation/coalescing lookup -- the currently-pending row (if any) sharing this local coalesce key. */
    @Query("SELECT * FROM sync_outbox_records WHERE coalesceKey = :coalesceKey AND state = :state LIMIT 1")
    suspend fun getByCoalesceKey(coalesceKey: String, state: SyncOutboxState): SyncOutboxRecordEntity?

    @Query(
        "UPDATE sync_outbox_records SET envelopeCipherEnc = :envelopeCipherEnc, envelopeCipherIv = :envelopeCipherIv, " +
            "sequence = :sequence, expiresAtEpochMillis = :expiresAtEpochMillis WHERE messageId = :messageId",
    )
    suspend fun coalesceUpdate(
        messageId: String,
        envelopeCipherEnc: String,
        envelopeCipherIv: String,
        sequence: Long,
        expiresAtEpochMillis: Long,
    ): Int
}
