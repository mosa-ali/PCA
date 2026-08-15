package org.pca.app.persistence.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import org.pca.app.persistence.entity.InstalledAppEventEntity

@Dao
interface InstalledAppEventDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(entity: InstalledAppEventEntity)

    @Query("SELECT * FROM installed_app_events WHERE deviceId = :deviceId ORDER BY installedAtEpochMillis DESC")
    suspend fun getForDevice(deviceId: String): List<InstalledAppEventEntity>

    @Query("SELECT COUNT(*) FROM installed_app_events WHERE deviceId = :deviceId AND installedAtEpochMillis < :cutoffEpochMillis")
    suspend fun countOlderThanForDevice(deviceId: String, cutoffEpochMillis: Long): Int

    @Query("DELETE FROM installed_app_events WHERE deviceId = :deviceId AND installedAtEpochMillis < :cutoffEpochMillis")
    suspend fun deleteOlderThanForDevice(deviceId: String, cutoffEpochMillis: Long): Int

    @Query("DELETE FROM installed_app_events WHERE deviceId = :deviceId")
    suspend fun deleteAllForDevice(deviceId: String): Int

    @Query("DELETE FROM installed_app_events WHERE deviceId IN " + FamilyScopeSql.DEVICE_IDS_FOR_FAMILY)
    suspend fun deleteAllForFamily(familyId: String): Int

    @Query("SELECT COUNT(*) FROM installed_app_events")
    suspend fun count(): Int
}
