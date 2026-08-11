package org.pca.app.persistence.entity

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * doc 10 Section 3.2. `displayNameEnc`/`displayNameIv` hold the
 * *(sensitive -- local plaintext only)* `displayName` field as a
 * Base64-encoded [org.pca.app.persistence.crypto.LocalRecordCipher]
 * ciphertext -- this value MUST NOT be included in any outbound sync
 * envelope metadata (doc 09 Section 4).
 */
@Entity(
    tableName = "family_members",
    indices = [Index("familyId"), Index("status")],
)
data class FamilyMemberEntity(
    @PrimaryKey val memberId: String,
    val familyId: String,
    val role: FamilyMemberRole,
    val displayNameEnc: String,
    val displayNameIv: String,
    val status: FamilyMemberStatus,
    val ageTier: String,
    val updatedAtEpochMillis: Long,
)
