package org.pca.app.persistence.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import org.pca.app.persistence.entity.PolicyReceiptEntity

@Dao
interface PolicyReceiptDao {
    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insert(entity: PolicyReceiptEntity): Long

    @Query("SELECT * FROM policy_receipts WHERE deviceId = :deviceId AND policyVersion = :version LIMIT 1")
    suspend fun getForDeviceAndVersion(deviceId: String, version: Long): PolicyReceiptEntity?

    @Query("SELECT * FROM policy_receipts WHERE deviceId = :deviceId ORDER BY policyVersion DESC")
    suspend fun getForDevice(deviceId: String): List<PolicyReceiptEntity>

    @Query("DELETE FROM policy_receipts WHERE deviceId = :deviceId")
    suspend fun deleteAllForDevice(deviceId: String): Int

    @Query("DELETE FROM policy_receipts")
    suspend fun deleteAll(): Int
}
