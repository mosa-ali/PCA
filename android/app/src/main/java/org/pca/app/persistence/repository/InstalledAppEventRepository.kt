package org.pca.app.persistence.repository

import org.pca.app.persistence.dao.InstalledAppEventDao
import org.pca.app.persistence.entity.InstalledAppEventEntity

/**
 * PCA-FR-045/PCA-FR-131: thin repository over [InstalledAppEventDao] -- the local record of
 * "a new app install was observed" that a future parent-facing app list/notification reads from.
 * `record` is `@Insert(REPLACE)`-backed on [id] (idempotent, process-restart safe), matching this
 * codebase's existing event-repository convention (see `PrayerReminderEventRepository`).
 */
class InstalledAppEventRepository(private val dao: InstalledAppEventDao) {
    suspend fun record(
        id: String,
        deviceId: String,
        packageName: String,
        appLabel: String?,
        installedAtEpochMillis: Long,
        observedAtEpochMillis: Long,
    ) {
        dao.upsert(
            InstalledAppEventEntity(
                id = id,
                deviceId = deviceId,
                packageName = packageName,
                appLabel = appLabel,
                installedAtEpochMillis = installedAtEpochMillis,
                observedAtEpochMillis = observedAtEpochMillis,
            ),
        )
    }

    suspend fun getForDevice(deviceId: String): List<InstalledAppEventEntity> = dao.getForDevice(deviceId)
}
