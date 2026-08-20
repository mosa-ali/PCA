package org.pca.app.persistence.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import org.pca.app.persistence.entity.EnrollmentLifecycleAuditEntity

@Dao
interface EnrollmentLifecycleAuditDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(entity: EnrollmentLifecycleAuditEntity)

    @Query("SELECT * FROM enrollment_lifecycle_audits WHERE deviceId = :deviceId ORDER BY occurredAtEpochMillis DESC")
    suspend fun getForDevice(deviceId: String): List<EnrollmentLifecycleAuditEntity>

    @Query("SELECT COUNT(*) FROM enrollment_lifecycle_audits")
    suspend fun count(): Int

    @Query("DELETE FROM enrollment_lifecycle_audits")
    suspend fun deleteAll(): Int
}
