package org.pca.app.persistence.repository

import org.pca.app.persistence.dao.PrayerReminderEventDao
import org.pca.app.persistence.entity.PrayerDeliveryState
import org.pca.app.persistence.entity.PrayerReminderEventEntity

/**
 * PCA-RUNTIME-PERSIST-1 Section 8: production persistence adapter for
 * [PrayerReminderEventEntity]. Delivery metadata only (doc 10 Section 4.7) --
 * no devotional-behavior profiling beyond what scheduling/delivery requires
 * (PCA-LOCAL-DB-1 Section 16). `record` is `@Insert(REPLACE)`-backed on [id]
 * (idempotent, process-restart safe) so a delivery-state transition
 * (SCHEDULED -> DELIVERED/MISSED/CANCELLED) is reported by re-calling
 * `record` with the same [id].
 */
class PrayerReminderEventRepository(private val dao: PrayerReminderEventDao) {
    suspend fun record(
        id: String,
        deviceId: String,
        prayerKey: String,
        scheduledAtEpochMillis: Long,
        deliveryState: PrayerDeliveryState,
    ) {
        dao.upsert(
            PrayerReminderEventEntity(
                id = id,
                deviceId = deviceId,
                prayerKey = prayerKey,
                scheduledAtEpochMillis = scheduledAtEpochMillis,
                deliveryState = deliveryState,
            ),
        )
    }

    suspend fun getForDevice(deviceId: String): List<PrayerReminderEventEntity> = dao.getForDevice(deviceId)
}
