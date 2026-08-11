package org.pca.app.persistence.entity

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * doc 10 Section 4.3. Records only the block *decision* -- no blocked
 * media/content is ever archived here (PCA-LOCAL-DB-1 Section 13).
 * `confidenceBucket` is a coarse bucket, never a raw model score
 * (doc 23 -- avoids over-precise-looking numbers the parent can't act on).
 */
@Entity(
    tableName = "content_block_events",
    indices = [Index("deviceId"), Index("timestampEpochMillis")],
)
data class ContentBlockEventEntity(
    @PrimaryKey val id: String,
    val deviceId: String,
    val category: String,
    val ruleOrModelVersion: String,
    val reasonCode: String,
    val confidenceBucket: String?,
    val timestampEpochMillis: Long,
)
