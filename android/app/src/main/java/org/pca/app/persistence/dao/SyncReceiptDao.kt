package org.pca.app.persistence.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import org.pca.app.persistence.entity.SyncReceiptApplicationState
import org.pca.app.persistence.entity.SyncReceiptRecordEntity

@Dao
interface SyncReceiptDao {
    /**
     * IGNORE on conflict: `messageId` is the primary key, so a duplicate
     * receipt delivery is silently dropped at the schema level -- the
     * caller inspects the return value (-1 on ignore) to detect and log a
     * duplicate rather than re-applying it (protects against duplicate
     * receipt, doc 09 Section 5.1).
     */
    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insertIfAbsent(entity: SyncReceiptRecordEntity): Long

    @Query("SELECT * FROM sync_receipt_records WHERE messageId = :messageId")
    suspend fun getById(messageId: String): SyncReceiptRecordEntity?

    @Query("SELECT MAX(sequence) FROM sync_receipt_records WHERE familyScope = :familyScope")
    suspend fun getMaxSequence(familyScope: String): Long?

    @Query("UPDATE sync_receipt_records SET applicationState = :state, appliedAtEpochMillis = :appliedAtEpochMillis WHERE messageId = :messageId")
    suspend fun markApplied(messageId: String, state: SyncReceiptApplicationState, appliedAtEpochMillis: Long): Int

    @Query("DELETE FROM sync_receipt_records WHERE familyScope = :familyScope")
    suspend fun deleteAllForFamily(familyScope: String): Int

    @Query("SELECT COUNT(*) FROM sync_receipt_records")
    suspend fun count(): Int
}
