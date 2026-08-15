package org.pca.app.persistence.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import org.pca.app.persistence.entity.TombstoneRecordEntity

@Dao
interface TombstoneRecordDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(entity: TombstoneRecordEntity)

    @Query("SELECT * FROM tombstone_records WHERE familyId = :familyId ORDER BY deletedAtEpochMillis DESC")
    suspend fun getForFamily(familyId: String): List<TombstoneRecordEntity>

    /** PCA-DATA-026 bounded-lifetime enforcement -- a tombstone is not kept forever. */
    @Query("DELETE FROM tombstone_records WHERE deletedAtEpochMillis < :cutoffEpochMillis")
    suspend fun deleteOlderThan(cutoffEpochMillis: Long): Int

    @Query("SELECT COUNT(*) FROM tombstone_records")
    suspend fun count(): Int

    @Query("DELETE FROM tombstone_records")
    suspend fun deleteAll(): Int
}
