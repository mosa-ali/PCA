package org.pca.app.persistence.entity

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/** doc 10 Section 4.5. Non-sensitive break/screen-time history. */
@Entity(
    tableName = "break_sessions",
    indices = [Index("deviceId"), Index("breakStartEpochMillis")],
)
data class BreakSessionEntity(
    @PrimaryKey val id: String,
    val deviceId: String,
    val triggerType: String,
    val continuousUseDurationMillis: Long,
    val breakStartEpochMillis: Long,
    val breakEndEpochMillis: Long?,
    val completionReason: String?,
    val optionalCounterTotal: Int?,
)
