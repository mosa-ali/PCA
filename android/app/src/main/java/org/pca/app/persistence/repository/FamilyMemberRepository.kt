package org.pca.app.persistence.repository

import org.pca.app.persistence.crypto.LocalRecordCipher
import org.pca.app.persistence.crypto.decryptFromColumns
import org.pca.app.persistence.crypto.encryptToColumns
import org.pca.app.persistence.dao.FamilyMemberDao
import org.pca.app.persistence.entity.FamilyMemberEntity
import org.pca.app.persistence.entity.FamilyMemberRole
import org.pca.app.persistence.entity.FamilyMemberStatus

data class FamilyMember(
    val memberId: String,
    val familyId: String,
    val role: FamilyMemberRole,
    val displayName: String,
    val status: FamilyMemberStatus,
    val ageTier: String,
    val updatedAtEpochMillis: Long,
)

/** doc 10 Section 3.2: `displayName` is *(sensitive -- local plaintext only)*, encrypted at rest here. */
class FamilyMemberRepository(
    private val dao: FamilyMemberDao,
    private val cipher: LocalRecordCipher,
) {
    suspend fun upsert(member: FamilyMember) {
        val (enc, iv) = cipher.encryptToColumns(member.displayName)
        dao.upsert(
            FamilyMemberEntity(
                memberId = member.memberId,
                familyId = member.familyId,
                role = member.role,
                displayNameEnc = enc,
                displayNameIv = iv,
                status = member.status,
                ageTier = member.ageTier,
                updatedAtEpochMillis = member.updatedAtEpochMillis,
            ),
        )
    }

    suspend fun getById(memberId: String): FamilyMember? = dao.getById(memberId)?.toDomain(cipher)

    private fun FamilyMemberEntity.toDomain(cipher: LocalRecordCipher): FamilyMember = FamilyMember(
        memberId = memberId,
        familyId = familyId,
        role = role,
        displayName = cipher.decryptFromColumns(displayNameEnc, displayNameIv),
        status = status,
        ageTier = ageTier,
        updatedAtEpochMillis = updatedAtEpochMillis,
    )
}
