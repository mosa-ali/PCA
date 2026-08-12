package org.pca.app.persistence.repository

import org.pca.app.persistence.dao.ProximityEventDao
import org.pca.app.persistence.entity.ProximityBucket
import org.pca.app.persistence.entity.ProximityEventEntity

/**
 * PCA-RUNTIME-PERSIST-1 Section 8: production persistence adapter for
 * [ProximityEventEntity]. [distanceBucket] is a coarse bucket only -- this
 * repository never accepts (and the underlying entity structurally cannot
 * hold) a precise coordinate, image, or biometric derivative (PCA-LOCAL-DB-1
 * Section 15). `record` is `@Insert(REPLACE)`-backed on [id] (idempotent,
 * process-restart safe, out-of-order safe).
 */
class ProximityEventRepository(private val dao: ProximityEventDao) {
    suspend fun record(
        id: String,
        deviceId: String,
        timestampEpochMillis: Long,
        distanceBucket: ProximityBucket,
        action: String,
    ) {
        dao.upsert(
            ProximityEventEntity(
                id = id,
                deviceId = deviceId,
                timestampEpochMillis = timestampEpochMillis,
                distanceBucket = distanceBucket,
                action = action,
            ),
        )
    }

    suspend fun getForDevice(deviceId: String): List<ProximityEventEntity> = dao.getForDevice(deviceId)
}
