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

    @Query(
        "SELECT * FROM sync_outbox_records WHERE state = :state " +
            "AND (nextRetryAtEpochMillis IS NULL OR nextRetryAtEpochMillis <= :nowEpochMillis) " +
            "ORDER BY sequence ASC",
    )
    suspend fun getReadyForDelivery(state: SyncOutboxState, nowEpochMillis: Long): List<SyncOutboxRecordEntity>

    @Query(
        "UPDATE sync_outbox_records SET state = :newState, retryCount = retryCount + 1, " +
            "nextRetryAtEpochMillis = :nextRetryAtEpochMillis WHERE messageId = :messageId",
    )
    suspend fun markRetry(messageId: String, newState: SyncOutboxState, nextRetryAtEpochMillis: Long?): Int

    @Query("UPDATE sync_outbox_records SET state = :newState WHERE messageId = :messageId")
    suspend fun updateState(messageId: String, newState: SyncOutboxState): Int

    @Query("DELETE FROM sync_outbox_records WHERE expiresAtEpochMillis < :nowEpochMillis")
    suspend fun deleteExpired(nowEpochMillis: Long): Int

    @Query("DELETE FROM sync_outbox_records WHERE familyScope = :familyScope")
    suspend fun deleteAllForFamily(familyScope: String): Int

    @Query("SELECT COUNT(*) FROM sync_outbox_records")
    suspend fun count(): Int
}
