package org.pca.app.persistence.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import org.pca.app.persistence.entity.ContentBlockEventEntity

@Dao
interface ContentBlockEventDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(entity: ContentBlockEventEntity)

    @Query("SELECT * FROM content_block_events WHERE deviceId = :deviceId ORDER BY timestampEpochMillis DESC")
    suspend fun getForDevice(deviceId: String): List<ContentBlockEventEntity>

    @Query("SELECT COUNT(*) FROM content_block_events WHERE timestampEpochMillis < :cutoffEpochMillis")
    suspend fun countOlderThan(cutoffEpochMillis: Long): Int

    @Query("DELETE FROM content_block_events WHERE timestampEpochMillis < :cutoffEpochMillis")
    suspend fun deleteOlderThan(cutoffEpochMillis: Long): Int

    @Query("DELETE FROM content_block_events WHERE deviceId = :deviceId AND timestampEpochMillis < :cutoffEpochMillis")
    suspend fun deleteOlderThanForDevice(deviceId: String, cutoffEpochMillis: Long): Int

    @Query("SELECT COUNT(*) FROM content_block_events WHERE deviceId = :deviceId AND timestampEpochMillis < :cutoffEpochMillis")
    suspend fun countOlderThanForDevice(deviceId: String, cutoffEpochMillis: Long): Int

    @Query("DELETE FROM content_block_events WHERE deviceId = :deviceId")
    suspend fun deleteAllForDevice(deviceId: String): Int

    @Query("DELETE FROM content_block_events WHERE deviceId IN " + FamilyScopeSql.DEVICE_IDS_FOR_FAMILY)
    suspend fun deleteAllForFamily(familyId: String): Int

    @Query("SELECT COUNT(*) FROM content_block_events")
    suspend fun count(): Int
}
