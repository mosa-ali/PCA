package org.pca.app.persistence.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import org.pca.app.persistence.entity.BreakSessionEntity

@Dao
interface BreakSessionDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(entity: BreakSessionEntity)

    @Query("SELECT * FROM break_sessions WHERE deviceId = :deviceId ORDER BY breakStartEpochMillis DESC")
    suspend fun getForDevice(deviceId: String): List<BreakSessionEntity>

    @Query("SELECT COUNT(*) FROM break_sessions WHERE breakStartEpochMillis < :cutoffEpochMillis")
    suspend fun countOlderThan(cutoffEpochMillis: Long): Int

    @Query("DELETE FROM break_sessions WHERE breakStartEpochMillis < :cutoffEpochMillis")
    suspend fun deleteOlderThan(cutoffEpochMillis: Long): Int

    @Query("DELETE FROM break_sessions WHERE deviceId = :deviceId AND breakStartEpochMillis < :cutoffEpochMillis")
    suspend fun deleteOlderThanForDevice(deviceId: String, cutoffEpochMillis: Long): Int

    @Query("SELECT COUNT(*) FROM break_sessions WHERE deviceId = :deviceId AND breakStartEpochMillis < :cutoffEpochMillis")
    suspend fun countOlderThanForDevice(deviceId: String, cutoffEpochMillis: Long): Int

    @Query("DELETE FROM break_sessions WHERE deviceId = :deviceId")
    suspend fun deleteAllForDevice(deviceId: String): Int

    @Query("DELETE FROM break_sessions WHERE deviceId IN " + FamilyScopeSql.DEVICE_IDS_FOR_FAMILY)
    suspend fun deleteAllForFamily(familyId: String): Int

    @Query("SELECT COUNT(*) FROM break_sessions")
    suspend fun count(): Int
}
