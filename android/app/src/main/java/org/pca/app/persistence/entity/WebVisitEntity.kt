package org.pca.app.persistence.entity

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * doc 10 Section 4.2. `domain`/`url`/`title` are encrypted (sensitive
 * browsing content); `url`/`title` are optional and mode-dependent
 * (doc 14 -- not populated for every browsing context, PCA-LOCAL-DB-1
 * Section 12). Subject to the general retention window (doc 11 Section 3.1).
 */
@Entity(
    tableName = "web_visits",
    indices = [Index("deviceId"), Index("timestampEpochMillis")],
)
data class WebVisitEntity(
    @PrimaryKey val id: String,
    val deviceId: String,
    val domainEnc: String,
    val domainIv: String,
    val urlEnc: String?,
    val urlIv: String?,
    val titleEnc: String?,
    val titleIv: String?,
    val classificationCategory: String,
    val ruleOrModelVersion: String,
    val action: WebVisitAction,
    val timestampEpochMillis: Long,
)
