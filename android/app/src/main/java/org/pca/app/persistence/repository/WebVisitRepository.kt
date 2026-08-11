package org.pca.app.persistence.repository

import java.util.UUID
import org.pca.app.persistence.crypto.LocalRecordCipher
import org.pca.app.persistence.crypto.decryptFromColumnsOrNull
import org.pca.app.persistence.crypto.encryptToColumns
import org.pca.app.persistence.crypto.encryptToColumnsOrNull
import org.pca.app.persistence.dao.WebVisitDao
import org.pca.app.persistence.entity.WebVisitAction
import org.pca.app.persistence.entity.WebVisitEntity

/** Plaintext view of [WebVisitEntity] -- the repository is the only place ciphertext round-trips to plaintext. */
data class WebVisit(
    val id: String,
    val deviceId: String,
    val domain: String,
    val url: String?,
    val title: String?,
    val classificationCategory: String,
    val ruleOrModelVersion: String,
    val action: WebVisitAction,
    val timestampEpochMillis: Long,
)

/**
 * Repository boundary between plaintext domain values and Room's
 * encrypted-at-rest columns (PCA-LOCAL-DB-1 Section 8/12). No caller above
 * this layer should construct a [WebVisitEntity] directly.
 */
class WebVisitRepository(
    private val dao: WebVisitDao,
    private val cipher: LocalRecordCipher,
) {
    suspend fun record(
        deviceId: String,
        domain: String,
        url: String?,
        title: String?,
        classificationCategory: String,
        ruleOrModelVersion: String,
        action: WebVisitAction,
        timestampEpochMillis: Long,
        id: String = UUID.randomUUID().toString(),
    ) {
        val (domainEnc, domainIv) = cipher.encryptToColumns(domain)
        val urlPair = cipher.encryptToColumnsOrNull(url)
        val titlePair = cipher.encryptToColumnsOrNull(title)
        dao.upsert(
            WebVisitEntity(
                id = id,
                deviceId = deviceId,
                domainEnc = domainEnc,
                domainIv = domainIv,
                urlEnc = urlPair?.first,
                urlIv = urlPair?.second,
                titleEnc = titlePair?.first,
                titleIv = titlePair?.second,
                classificationCategory = classificationCategory,
                ruleOrModelVersion = ruleOrModelVersion,
                action = action,
                timestampEpochMillis = timestampEpochMillis,
            ),
        )
    }

    suspend fun getForDevice(deviceId: String): List<WebVisit> =
        dao.getForDevice(deviceId).map { it.toDomain(cipher) }

    private fun WebVisitEntity.toDomain(cipher: LocalRecordCipher): WebVisit = WebVisit(
        id = id,
        deviceId = deviceId,
        domain = cipher.decryptFromColumnsOrNull(domainEnc, domainIv)
            ?: error("WebVisit domain must always be present"),
        url = cipher.decryptFromColumnsOrNull(urlEnc, urlIv),
        title = cipher.decryptFromColumnsOrNull(titleEnc, titleIv),
        classificationCategory = classificationCategory,
        ruleOrModelVersion = ruleOrModelVersion,
        action = action,
        timestampEpochMillis = timestampEpochMillis,
    )
}
