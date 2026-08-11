package org.pca.app.persistence.repository

import java.util.UUID
import org.pca.app.persistence.crypto.LocalRecordCipher
import org.pca.app.persistence.crypto.decryptFromColumns
import org.pca.app.persistence.crypto.encryptToColumns
import org.pca.app.persistence.dao.LocationPointDao
import org.pca.app.persistence.entity.LocationPointEntity
import org.pca.app.persistence.entity.RetentionPolicy

data class LocationPoint(
    val id: String,
    val deviceId: String,
    val timestampEpochMillis: Long,
    val latitude: Double,
    val longitude: Double,
    val accuracyMeters: Float,
    val source: String,
    val retentionPolicy: RetentionPolicy,
)

/**
 * doc 10 Section 4.4 / PCA-LOCAL-DB-1 Section 14: latitude/longitude are
 * always encrypted at rest. When [RetentionPolicy.LATEST_ONLY] is in effect
 * for a device, [record] enforces the rolling one-record retention
 * (doc 11 Section 4) in the same transaction as the insert -- so no reader
 * can ever observe more than one retained point for that device.
 */
class LocationPointRepository(
    private val dao: LocationPointDao,
    private val cipher: LocalRecordCipher,
) {
    suspend fun record(
        deviceId: String,
        timestampEpochMillis: Long,
        latitude: Double,
        longitude: Double,
        accuracyMeters: Float,
        source: String,
        retentionPolicy: RetentionPolicy,
        id: String = UUID.randomUUID().toString(),
    ) {
        val (latEnc, latIv) = cipher.encryptToColumns(latitude.toString())
        val (lonEnc, lonIv) = cipher.encryptToColumns(longitude.toString())
        dao.upsert(
            LocationPointEntity(
                id = id,
                deviceId = deviceId,
                timestampEpochMillis = timestampEpochMillis,
                latitudeEnc = latEnc,
                latitudeIv = latIv,
                longitudeEnc = lonEnc,
                longitudeIv = lonIv,
                accuracyMeters = accuracyMeters,
                source = source,
                retentionPolicy = retentionPolicy,
            ),
        )
        if (retentionPolicy == RetentionPolicy.LATEST_ONLY) {
            dao.deleteAllExceptLatestForDevice(deviceId)
        }
    }

    suspend fun getForDevice(deviceId: String): List<LocationPoint> =
        dao.getForDevice(deviceId).map { it.toDomain(cipher) }

    private fun LocationPointEntity.toDomain(cipher: LocalRecordCipher): LocationPoint = LocationPoint(
        id = id,
        deviceId = deviceId,
        timestampEpochMillis = timestampEpochMillis,
        latitude = cipher.decryptFromColumns(latitudeEnc, latitudeIv).toDouble(),
        longitude = cipher.decryptFromColumns(longitudeEnc, longitudeIv).toDouble(),
        accuracyMeters = accuracyMeters,
        source = source,
        retentionPolicy = retentionPolicy,
    )
}
