package org.pca.app.persistence.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import org.pca.app.persistence.entity.LocationPointEntity

@Dao
interface LocationPointDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(entity: LocationPointEntity)

    @Query("SELECT * FROM location_points WHERE deviceId = :deviceId ORDER BY timestampEpochMillis DESC")
    suspend fun getForDevice(deviceId: String): List<LocationPointEntity>

    @Query("SELECT COUNT(*) FROM location_points WHERE timestampEpochMillis < :cutoffEpochMillis")
    suspend fun countOlderThan(cutoffEpochMillis: Long): Int

    @Query("DELETE FROM location_points WHERE timestampEpochMillis < :cutoffEpochMillis")
    suspend fun deleteOlderThan(cutoffEpochMillis: Long): Int

    @Query("DELETE FROM location_points WHERE deviceId = :deviceId AND timestampEpochMillis < :cutoffEpochMillis")
    suspend fun deleteOlderThanForDevice(deviceId: String, cutoffEpochMillis: Long): Int

    @Query("SELECT COUNT(*) FROM location_points WHERE deviceId = :deviceId AND timestampEpochMillis < :cutoffEpochMillis")
    suspend fun countOlderThanForDevice(deviceId: String, cutoffEpochMillis: Long): Int

    /** doc 11 Section 4 rolling one-record mode: keep only the newest row for [deviceId]. */
    @Query(
        "DELETE FROM location_points WHERE deviceId = :deviceId AND id NOT IN " +
            "(SELECT id FROM location_points WHERE deviceId = :deviceId ORDER BY timestampEpochMillis DESC LIMIT 1)",
    )
    suspend fun deleteAllExceptLatestForDevice(deviceId: String): Int

    @Query("SELECT DISTINCT deviceId FROM location_points WHERE retentionPolicy = 'LATEST_ONLY'")
    suspend fun getDeviceIdsUsingLatestOnly(): List<String>

    @Query("DELETE FROM location_points WHERE deviceId = :deviceId")
    suspend fun deleteAllForDevice(deviceId: String): Int

    @Query("SELECT COUNT(*) FROM location_points")
    suspend fun count(): Int
}
