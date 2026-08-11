package org.pca.app.persistence.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import kotlinx.coroutines.flow.Flow
import org.pca.app.persistence.entity.FamilyMemberEntity

@Dao
interface FamilyMemberDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(entity: FamilyMemberEntity)

    @Query("SELECT * FROM family_members WHERE memberId = :memberId")
    suspend fun getById(memberId: String): FamilyMemberEntity?

    @Query("SELECT * FROM family_members WHERE familyId = :familyId")
    fun observeByFamily(familyId: String): Flow<List<FamilyMemberEntity>>

    @Query("SELECT COUNT(*) FROM family_members")
    suspend fun count(): Int

    @Query("DELETE FROM family_members WHERE familyId = :familyId")
    suspend fun deleteAllForFamily(familyId: String): Int

    @Query("DELETE FROM family_members WHERE memberId = :memberId")
    suspend fun deleteById(memberId: String): Int
}
