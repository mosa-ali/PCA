package org.pca.app.persistence.repository

import org.pca.app.persistence.crypto.LocalRecordCipher
import org.pca.app.persistence.crypto.decryptFromColumns
import org.pca.app.persistence.crypto.decryptFromColumnsOrNull
import org.pca.app.persistence.crypto.encryptToColumns
import org.pca.app.persistence.crypto.encryptToColumnsOrNull
import org.pca.app.persistence.dao.InstalledAppEventDao
import org.pca.app.persistence.entity.InstalledAppEventEntity

/**
 * Plaintext view of [InstalledAppEventEntity] -- the repository is the only place ciphertext
 * round-trips to plaintext, exactly as [UsageSession] is for `usage_sessions`.
 */
data class InstalledAppEvent(
    val id: String,
    val deviceId: String,
    val packageName: String,
    val appLabel: String?,
    val installedAtEpochMillis: Long,
    val observedAtEpochMillis: Long,
)

/**
 * PCA-FR-045/PCA-FR-131: thin repository over [InstalledAppEventDao] -- the local record of
 * "a new app install was observed" that a parent-facing app list/notification reads from.
 * `record` is `@Insert(REPLACE)`-backed on [id] (idempotent, process-restart safe), matching this
 * codebase's existing event-repository convention (see `PrayerReminderEventRepository`).
 *
 * PCA-LOCAL-DB-1 Section 8: the package name and label are encrypted at rest via the SAME
 * [LocalRecordCipher] instance [UsageSessionRepository] uses for its own app/category token (see
 * [InstalledAppEventEntity]'s doc comment for why they are the identical class of family-sensitive
 * value). Reusing [encryptToColumns]/[decryptFromColumns] rather than touching cipher primitives
 * directly keeps this repository free of any cryptographic decision of its own.
 */
class InstalledAppEventRepository(
    private val dao: InstalledAppEventDao,
    private val cipher: LocalRecordCipher,
) {
    suspend fun record(
        id: String,
        deviceId: String,
        packageName: String,
        appLabel: String?,
        installedAtEpochMillis: Long,
        observedAtEpochMillis: Long,
    ) {
        val (packageNameEnc, packageNameIv) = cipher.encryptToColumns(packageName)
        val label = cipher.encryptToColumnsOrNull(appLabel)
        dao.upsert(
            InstalledAppEventEntity(
                id = id,
                deviceId = deviceId,
                packageNameEnc = packageNameEnc,
                packageNameIv = packageNameIv,
                appLabelEnc = label?.first,
                appLabelIv = label?.second,
                installedAtEpochMillis = installedAtEpochMillis,
                observedAtEpochMillis = observedAtEpochMillis,
            ),
        )
    }

    suspend fun getForDevice(deviceId: String): List<InstalledAppEvent> =
        dao.getForDevice(deviceId).map { it.toDomain(cipher) }

    private fun InstalledAppEventEntity.toDomain(cipher: LocalRecordCipher): InstalledAppEvent = InstalledAppEvent(
        id = id,
        deviceId = deviceId,
        packageName = cipher.decryptFromColumns(packageNameEnc, packageNameIv),
        appLabel = cipher.decryptFromColumnsOrNull(appLabelEnc, appLabelIv),
        installedAtEpochMillis = installedAtEpochMillis,
        observedAtEpochMillis = observedAtEpochMillis,
    )
}
