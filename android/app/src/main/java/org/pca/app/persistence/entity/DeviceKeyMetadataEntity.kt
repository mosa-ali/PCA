package org.pca.app.persistence.entity

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/** doc 10 Section 5. Never stores a private key -- public key ID reference only. */
@Entity(
    tableName = "device_key_metadata",
    indices = [Index("deviceId"), Index("keyState")],
)
data class DeviceKeyMetadataEntity(
    @PrimaryKey val publicKeyId: String,
    val deviceId: String,
    val keyState: DeviceKeyState,
    val establishedAtEpochMillis: Long,
)
