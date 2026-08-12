package org.pca.app.persistence.repository

import org.pca.app.persistence.dao.BreakSessionDao
import org.pca.app.persistence.entity.BreakSessionEntity

/**
 * PCA-RUNTIME-PERSIST-1 Section 8: production persistence adapter for
 * [BreakSessionEntity]. Non-sensitive per doc 10 Section 4.5 -- no field
 * encryption needed. `record` is `@Insert(REPLACE)`-backed on [id]
 * (idempotent, process-restart safe) and callers may report a break's end
 * (or an out-of-order retry) by re-calling `record` with the same [id].
 */
class BreakSessionRepository(private val dao: BreakSessionDao) {
    suspend fun record(
        id: String,
        deviceId: String,
        triggerType: String,
        continuousUseDurationMillis: Long,
        breakStartEpochMillis: Long,
        breakEndEpochMillis: Long?,
        completionReason: String?,
        optionalCounterTotal: Int?,
    ) {
        dao.upsert(
            BreakSessionEntity(
                id = id,
                deviceId = deviceId,
                triggerType = triggerType,
                continuousUseDurationMillis = continuousUseDurationMillis,
                breakStartEpochMillis = breakStartEpochMillis,
                breakEndEpochMillis = breakEndEpochMillis,
                completionReason = completionReason,
                optionalCounterTotal = optionalCounterTotal,
            ),
        )
    }

    suspend fun getForDevice(deviceId: String): List<BreakSessionEntity> = dao.getForDevice(deviceId)
}
