package org.pca.app.persistence.repository

import org.pca.app.persistence.dao.TamperEventDao
import org.pca.app.persistence.entity.TamperEventEntity

/**
 * PCA-FR-085 closure: production persistence adapter for [TamperEventEntity]. Until this class
 * existed, [TamperEventDao]/[TamperEventEntity] were schema-only -- nothing in the app ever
 * constructed or wrote a row (a fresh audit's exact finding). See
 * [org.pca.app.runtime.tamper.UsageAccessDegradationMonitor] for the one real, documented-API-only
 * producer this lane adds (usage-access permission revocation, detected via
 * [org.pca.app.platform.UsageAccessStateTracker]'s own evidence-backed history, never a guess).
 *
 * `@Insert(REPLACE)`-backed on [TamperEventEntity.id] (see [TamperEventDao.upsert]) -- a caller
 * that re-records the same tamper condition id is an idempotent upsert, not a duplicate row.
 */
class TamperEventRepository(private val dao: TamperEventDao) {
    suspend fun record(
        id: String,
        deviceId: String,
        conditionType: String,
        detectedAtEpochMillis: Long,
        resolvedAtEpochMillis: Long? = null,
    ) {
        dao.upsert(
            TamperEventEntity(
                id = id,
                deviceId = deviceId,
                conditionType = conditionType,
                detectedAtEpochMillis = detectedAtEpochMillis,
                resolvedAtEpochMillis = resolvedAtEpochMillis,
            ),
        )
    }

    suspend fun getForDevice(deviceId: String): List<TamperEventEntity> = dao.getForDevice(deviceId)
}
