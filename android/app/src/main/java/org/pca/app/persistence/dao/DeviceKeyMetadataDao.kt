package org.pca.app.persistence.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import org.pca.app.persistence.entity.DeviceKeyMetadataEntity

@Dao
interface DeviceKeyMetadataDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(entity: DeviceKeyMetadataEntity)

    @Query("SELECT * FROM device_key_metadata WHERE deviceId = :deviceId")
    suspend fun getForDevice(deviceId: String): List<DeviceKeyMetadataEntity>

    @Query("DELETE FROM device_key_metadata WHERE deviceId = :deviceId")
    suspend fun deleteAllForDevice(deviceId: String): Int

    @Query("DELETE FROM device_key_metadata WHERE deviceId IN " + FamilyScopeSql.DEVICE_IDS_FOR_FAMILY)
    suspend fun deleteAllForFamily(familyId: String): Int

    @Query("DELETE FROM device_key_metadata")
    suspend fun deleteAll(): Int
}
