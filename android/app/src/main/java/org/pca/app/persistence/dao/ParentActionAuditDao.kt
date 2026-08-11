package org.pca.app.persistence.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import org.pca.app.persistence.entity.ParentActionAuditEntity

@Dao
interface ParentActionAuditDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(entity: ParentActionAuditEntity)

    @Query("SELECT * FROM parent_action_audits WHERE actorMemberId = :memberId ORDER BY timestampEpochMillis DESC")
    suspend fun getForActor(memberId: String): List<ParentActionAuditEntity>

    /** Audit floor deletion only (PCA-DATA-021) -- never the general activity cutoff. */
    @Query("DELETE FROM parent_action_audits WHERE timestampEpochMillis < :auditFloorCutoffEpochMillis")
    suspend fun deleteOlderThanAuditFloor(auditFloorCutoffEpochMillis: Long): Int

    @Query("SELECT COUNT(*) FROM parent_action_audits WHERE timestampEpochMillis < :auditFloorCutoffEpochMillis")
    suspend fun countOlderThanAuditFloor(auditFloorCutoffEpochMillis: Long): Int

    @Query("SELECT COUNT(*) FROM parent_action_audits")
    suspend fun count(): Int

    @Query("DELETE FROM parent_action_audits")
    suspend fun deleteAll(): Int

    @Query("DELETE FROM parent_action_audits WHERE actorMemberId = :memberId")
    suspend fun deleteAllForActor(memberId: String): Int
}
