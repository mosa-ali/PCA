package org.pca.app.persistence.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import org.pca.app.persistence.entity.PolicySnapshotEntity

@Dao
interface PolicySnapshotDao {
    @Insert(onConflict = OnConflictStrategy.ABORT)
    suspend fun insert(entity: PolicySnapshotEntity)

    /** Used only for persisting a rejected/stale/epoch-mismatch attempt as history (never for the accepted-latest row) -- IGNORE makes a duplicate rejected retry a no-op rather than a crash. */
    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insertIgnoreConflict(entity: PolicySnapshotEntity): Long

    @Query("SELECT * FROM policy_snapshots WHERE childDeviceId = :deviceId AND isLatestValid = 1 LIMIT 1")
    suspend fun getLatestValid(deviceId: String): PolicySnapshotEntity?

    @Query("SELECT MAX(version) FROM policy_snapshots WHERE childDeviceId = :deviceId")
    suspend fun getMaxVersion(deviceId: String): Long?

    @Query("UPDATE policy_snapshots SET isLatestValid = 0 WHERE childDeviceId = :deviceId")
    suspend fun clearLatestFlag(deviceId: String)

    @Query("SELECT * FROM policy_snapshots WHERE childDeviceId = :deviceId ORDER BY version DESC")
    suspend fun getHistory(deviceId: String): List<PolicySnapshotEntity>

    @Query("DELETE FROM policy_snapshots WHERE childDeviceId = :deviceId")
    suspend fun deleteAllForDevice(deviceId: String): Int

    @Query("DELETE FROM policy_snapshots WHERE childDeviceId IN " + FamilyScopeSql.DEVICE_IDS_FOR_FAMILY)
    suspend fun deleteAllForFamily(familyId: String): Int

    @Query("DELETE FROM policy_snapshots")
    suspend fun deleteAll(): Int
}
