package org.pca.app.persistence.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import kotlinx.coroutines.flow.Flow
import org.pca.app.persistence.entity.DeviceEntity

@Dao
interface DeviceDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(entity: DeviceEntity)

    @Query("SELECT * FROM devices WHERE deviceId = :deviceId")
    suspend fun getById(deviceId: String): DeviceEntity?

    @Query("SELECT * FROM devices WHERE memberId = :memberId")
    fun observeByMember(memberId: String): Flow<List<DeviceEntity>>

    @Query("SELECT * FROM devices")
    suspend fun getAll(): List<DeviceEntity>

    @Query("DELETE FROM devices WHERE deviceId = :deviceId")
    suspend fun deleteById(deviceId: String): Int

    @Query("DELETE FROM devices")
    suspend fun deleteAll(): Int
}
