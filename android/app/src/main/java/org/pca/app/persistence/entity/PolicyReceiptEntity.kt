package org.pca.app.persistence.entity

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * doc 10 Section 5. Signed status receipt confirming a specific
 * `Policy.version` was verified and applied by a specific device -- lets
 * the parent UI distinguish "edit sent" from "edit confirmed applied"
 * (doc 05 PCA-FR-139). Security/audit-adjacent; not subject to the general
 * activity retention window by default (retained alongside its policy).
 */
@Entity(
    tableName = "policy_receipts",
    indices = [Index("deviceId"), Index(value = ["deviceId", "policyVersion"], unique = true)],
)
data class PolicyReceiptEntity(
    @PrimaryKey val id: String,
    val deviceId: String,
    val policyId: String,
    val policyVersion: Long,
    val verifiedAtEpochMillis: Long,
    val appliedAtEpochMillis: Long,
    val signedByKeyId: String,
)
