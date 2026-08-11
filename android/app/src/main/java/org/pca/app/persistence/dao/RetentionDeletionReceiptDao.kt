package org.pca.app.persistence.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import org.pca.app.persistence.entity.RetentionDeletionReceiptEntity

@Dao
interface RetentionDeletionReceiptDao {
    @Insert(onConflict = OnConflictStrategy.ABORT)
    suspend fun insert(entity: RetentionDeletionReceiptEntity)

    @Query("SELECT * FROM retention_deletion_receipts WHERE familyId = :familyId ORDER BY createdAtEpochMillis DESC")
    suspend fun getForFamily(familyId: String): List<RetentionDeletionReceiptEntity>

    @Query("SELECT COUNT(*) FROM retention_deletion_receipts")
    suspend fun count(): Int
}
