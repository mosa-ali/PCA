package org.pca.app.persistence.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import org.pca.app.persistence.entity.WebVisitEntity

@Dao
interface WebVisitDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(entity: WebVisitEntity)

    @Query("SELECT * FROM web_visits WHERE deviceId = :deviceId ORDER BY timestampEpochMillis DESC")
    suspend fun getForDevice(deviceId: String): List<WebVisitEntity>

    @Query("SELECT COUNT(*) FROM web_visits WHERE timestampEpochMillis < :cutoffEpochMillis")
    suspend fun countOlderThan(cutoffEpochMillis: Long): Int

    @Query("DELETE FROM web_visits WHERE timestampEpochMillis < :cutoffEpochMillis")
    suspend fun deleteOlderThan(cutoffEpochMillis: Long): Int

    @Query("DELETE FROM web_visits WHERE deviceId = :deviceId AND timestampEpochMillis < :cutoffEpochMillis")
    suspend fun deleteOlderThanForDevice(deviceId: String, cutoffEpochMillis: Long): Int

    @Query("SELECT COUNT(*) FROM web_visits WHERE deviceId = :deviceId AND timestampEpochMillis < :cutoffEpochMillis")
    suspend fun countOlderThanForDevice(deviceId: String, cutoffEpochMillis: Long): Int

    @Query("DELETE FROM web_visits WHERE deviceId = :deviceId")
    suspend fun deleteAllForDevice(deviceId: String): Int

    @Query("SELECT COUNT(*) FROM web_visits")
    suspend fun count(): Int
}
