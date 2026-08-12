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

    /**
     * Family-scoped by `memberId` directly (devices have no `familyId` column
     * of their own) -- MUST run before `family_members` rows for this family
     * are deleted, and after every table whose own `deleteAllForFamily` joins
     * through `devices` (Section 21 ordering: children before this parent).
     */
    @Query("DELETE FROM devices WHERE memberId IN " + FamilyScopeSql.MEMBER_IDS_FOR_FAMILY)
    suspend fun deleteAllForFamily(familyId: String): Int

    @Query("DELETE FROM devices")
    suspend fun deleteAll(): Int
}
