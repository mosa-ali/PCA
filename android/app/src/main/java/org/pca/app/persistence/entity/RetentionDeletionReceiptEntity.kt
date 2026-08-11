package org.pca.app.persistence.entity

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * doc 10 Section 5 / doc 11 Section 5 step 7. Non-sensitive: counts and
 * category only, NEVER the deleted content itself -- this table must never
 * become a second, lower-fidelity copy of what it documents having deleted.
 */
@Entity(
    tableName = "retention_deletion_receipts",
    indices = [Index("familyId"), Index("createdAtEpochMillis")],
)
data class RetentionDeletionReceiptEntity(
    @PrimaryKey val id: String,
    val familyId: String,
    val deviceId: String?,
    val entityCategory: String,
    val deletedCount: Int,
    val cutoffEpochMillis: Long,
    val createdAtEpochMillis: Long,
    val reason: String,
)
