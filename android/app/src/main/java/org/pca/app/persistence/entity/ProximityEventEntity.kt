package org.pca.app.persistence.entity

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * doc 10 Section 4.6. `distanceBucket` is a coarse bucket only -- this
 * entity has NO field capable of holding a face image, face landmark, or
 * any biometric derivative (structural guarantee, PCA-LOCAL-DB-1 Section 15
 * / doc 09 Section 5.3).
 */
@Entity(
    tableName = "proximity_events",
    indices = [Index("deviceId"), Index("timestampEpochMillis")],
)
data class ProximityEventEntity(
    @PrimaryKey val id: String,
    val deviceId: String,
    val timestampEpochMillis: Long,
    val distanceBucket: ProximityBucket,
    val action: String,
)
