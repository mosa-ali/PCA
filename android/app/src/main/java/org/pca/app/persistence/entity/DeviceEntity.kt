package org.pca.app.persistence.entity

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * doc 10 Section 3.3. `deviceId` is opaque per PCA-DATA-012. Public key IDs
 * are non-sensitive references (never the private key material itself,
 * which stays in platform Keystore -- PCA-LOCAL-DB-1 Section 7).
 * `capabilityProfileJson` is a compact JSON blob (non-sensitive: which
 * optional platform capabilities are granted, not content).
 */
@Entity(
    tableName = "devices",
    indices = [Index("memberId"), Index("enrollmentState"), Index("lastSeenAtEpochMillis")],
)
data class DeviceEntity(
    @PrimaryKey val deviceId: String,
    val memberId: String,
    val platform: DevicePlatform,
    val platformVersion: String,
    val appVersion: String,
    val signingKeyId: String,
    val encryptionKeyId: String,
    val trustSetEpoch: Long,
    val keyEpoch: Long,
    val trustState: DeviceTrustState,
    val enrollmentState: DeviceEnrollmentState,
    val lastSeenAtEpochMillis: Long,
    val capabilityProfileJson: String,
)
