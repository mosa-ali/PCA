package org.pca.app.persistence.entity

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * doc 10 Section 4.1. `appOrCategoryTokenEnc` is encrypted -- an app/package
 * identifier can be family-sensitive. `sourceConfidence` lets the parent UI
 * (doc 18) distinguish a platform-reported value from an inferred one
 * (PCA-LOCAL-DB-1 Section 11 -- no claim of universal activity visibility).
 */
@Entity(
    tableName = "usage_sessions",
    indices = [Index("deviceId"), Index("startedAtEpochMillis")],
)
data class UsageSessionEntity(
    @PrimaryKey val id: String,
    val deviceId: String,
    val appOrCategoryTokenEnc: String,
    val appOrCategoryTokenIv: String,
    val startedAtEpochMillis: Long,
    val endedAtEpochMillis: Long,
    val durationMillis: Long,
    val sourceConfidence: SourceConfidence,
)
