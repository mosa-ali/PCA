package org.pca.app.persistence.entity

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * doc 10 Section 5 / doc 03 PCA-FR-124. Same longer audit-retention floor as
 * [TamperEventEntity] (PCA-DATA-013/021) -- the retention engine's scope
 * query (doc 11 Section 5 step 2) MUST NOT be capable of matching this
 * table under the general activity cutoff. `reasonEnc`/`reasonIv` are
 * optional free-text and encrypted when present.
 */
@Entity(
    tableName = "parent_action_audits",
    indices = [Index("actorMemberId"), Index("timestampEpochMillis")],
)
data class ParentActionAuditEntity(
    @PrimaryKey val id: String,
    val actorMemberId: String,
    val actionType: ParentActionType,
    val targetEntity: String,
    val timestampEpochMillis: Long,
    val reasonEnc: String?,
    val reasonIv: String?,
)
