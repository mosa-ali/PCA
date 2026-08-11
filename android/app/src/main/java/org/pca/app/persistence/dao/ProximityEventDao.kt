package org.pca.app.persistence.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import org.pca.app.persistence.entity.ProximityEventEntity

@Dao
interface ProximityEventDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(entity: ProximityEventEntity)

    @Query("SELECT * FROM proximity_events WHERE deviceId = :deviceId ORDER BY timestampEpochMillis DESC")
    suspend fun getForDevice(deviceId: String): List<ProximityEventEntity>

    @Query("SELECT COUNT(*) FROM proximity_events WHERE timestampEpochMillis < :cutoffEpochMillis")
    suspend fun countOlderThan(cutoffEpochMillis: Long): Int

    @Query("DELETE FROM proximity_events WHERE timestampEpochMillis < :cutoffEpochMillis")
    suspend fun deleteOlderThan(cutoffEpochMillis: Long): Int

    @Query("DELETE FROM proximity_events WHERE deviceId = :deviceId AND timestampEpochMillis < :cutoffEpochMillis")
    suspend fun deleteOlderThanForDevice(deviceId: String, cutoffEpochMillis: Long): Int

    @Query("SELECT COUNT(*) FROM proximity_events WHERE deviceId = :deviceId AND timestampEpochMillis < :cutoffEpochMillis")
    suspend fun countOlderThanForDevice(deviceId: String, cutoffEpochMillis: Long): Int

    @Query("DELETE FROM proximity_events WHERE deviceId = :deviceId")
    suspend fun deleteAllForDevice(deviceId: String): Int

    @Query("SELECT COUNT(*) FROM proximity_events")
    suspend fun count(): Int
}
