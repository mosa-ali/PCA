package org.pca.app.persistence.entity

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * doc 10 Section 3.4 / PCA-LOCAL-DB-1 Section 10. This is the *received and
 * applied* local projection of a parent-authored, signed `Policy` -- the
 * encrypted payload/reference is opaque to this table (decrypted only in
 * memory by the policy-application layer, never re-persisted plaintext
 * here). `version` MUST be checked strictly monotonic by the repository
 * layer before insert (doc 05 Section 6) -- rollback (a lower version
 * arriving after a higher one is already applied) MUST be rejected, not
 * silently overwritten.
 */
@Entity(
    tableName = "policy_snapshots",
    indices = [Index("childDeviceId"), Index(value = ["childDeviceId", "version"], unique = true)],
)
data class PolicySnapshotEntity(
    @PrimaryKey val policyId: String,
    val childDeviceId: String,
    val version: Long,
    val effectiveFromEpochMillis: Long,
    val expiresAtEpochMillis: Long?,
    val encryptedPayloadEnc: String,
    val encryptedPayloadIv: String,
    val trustSetEpoch: Long,
    val keyEpoch: Long,
    val signedByKeyId: String,
    val receivedAtEpochMillis: Long,
    val appliedAtEpochMillis: Long?,
    val applicationResult: String,
    val isLatestValid: Boolean,
)
