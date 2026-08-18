package org.pca.app.persistence.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import org.pca.app.persistence.entity.TamperEventEntity

@Dao
interface TamperEventDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(entity: TamperEventEntity)

    @Query("SELECT * FROM tamper_events WHERE deviceId = :deviceId ORDER BY detectedAtEpochMillis DESC")
    suspend fun getForDevice(deviceId: String): List<TamperEventEntity>

    @Query("SELECT * FROM tamper_events WHERE deviceId IN " + FamilyScopeSql.DEVICE_IDS_FOR_FAMILY + " ORDER BY detectedAtEpochMillis DESC")
    suspend fun getForFamily(familyId: String): List<TamperEventEntity>

    /** Audit floor deletion only (PCA-DATA-021) -- never the general activity cutoff. */
    @Query("DELETE FROM tamper_events WHERE detectedAtEpochMillis < :auditFloorCutoffEpochMillis")
    suspend fun deleteOlderThanAuditFloor(auditFloorCutoffEpochMillis: Long): Int

    @Query("SELECT COUNT(*) FROM tamper_events WHERE detectedAtEpochMillis < :auditFloorCutoffEpochMillis")
    suspend fun countOlderThanAuditFloor(auditFloorCutoffEpochMillis: Long): Int

    @Query("DELETE FROM tamper_events WHERE deviceId = :deviceId")
    suspend fun deleteAllForDevice(deviceId: String): Int

    @Query("DELETE FROM tamper_events WHERE deviceId IN " + FamilyScopeSql.DEVICE_IDS_FOR_FAMILY)
    suspend fun deleteAllForFamily(familyId: String): Int

    @Query("SELECT COUNT(*) FROM tamper_events")
    suspend fun count(): Int

    @Query("DELETE FROM tamper_events")
    suspend fun deleteAll(): Int
}
