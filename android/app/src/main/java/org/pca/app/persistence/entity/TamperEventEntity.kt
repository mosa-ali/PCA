package org.pca.app.persistence.entity

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * doc 10 Section 5, PCA-DATA-013/021: retained for the family's general
 * activity window OR 12 months, whichever is LONGER -- the retention engine
 * MUST NOT apply the general/short activity cutoff to this table (doc 11
 * Section 3.2/3.3).
 */
@Entity(
    tableName = "tamper_events",
    indices = [Index("deviceId"), Index("detectedAtEpochMillis")],
)
data class TamperEventEntity(
    @PrimaryKey val id: String,
    val deviceId: String,
    val conditionType: String,
    val detectedAtEpochMillis: Long,
    val resolvedAtEpochMillis: Long?,
)
