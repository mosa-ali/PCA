package org.pca.app.persistence.entity

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * doc 10 Section 4.4. Latitude/longitude are highly sensitive and always
 * encrypted (PCA-LOCAL-DB-1 Section 14). `retentionPolicy` is this entity's
 * OWN field (never inherited from `Family.defaultRetentionPolicy`) so the
 * structural shorter-or-equal rule (doc 11 Section 4, doc 10 Section 9
 * failure-mode row) cannot silently regress to the general window.
 * `retentionPolicy == LATEST_ONLY` means the retention engine keeps only
 * the newest row per `deviceId` (doc 11 Section 4's rolling one-record mode).
 */
@Entity(
    tableName = "location_points",
    indices = [Index("deviceId"), Index("timestampEpochMillis")],
)
data class LocationPointEntity(
    @PrimaryKey val id: String,
    val deviceId: String,
    val timestampEpochMillis: Long,
    val latitudeEnc: String,
    val latitudeIv: String,
    val longitudeEnc: String,
    val longitudeIv: String,
    val accuracyMeters: Float,
    val source: String,
    val retentionPolicy: RetentionPolicy,
)
