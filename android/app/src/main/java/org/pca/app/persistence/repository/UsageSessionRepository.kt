package org.pca.app.persistence.repository

import org.pca.app.persistence.crypto.LocalRecordCipher
import org.pca.app.persistence.crypto.decryptFromColumns
import org.pca.app.persistence.crypto.encryptToColumns
import org.pca.app.persistence.dao.UsageSessionDao
import org.pca.app.persistence.entity.SourceConfidence
import org.pca.app.persistence.entity.UsageSessionEntity

/** Plaintext view of [UsageSessionEntity] -- the repository is the only place ciphertext round-trips to plaintext. */
data class UsageSession(
    val id: String,
    val deviceId: String,
    val appOrCategoryToken: String,
    val startedAtEpochMillis: Long,
    val endedAtEpochMillis: Long,
    val durationMillis: Long,
    val sourceConfidence: SourceConfidence,
)

/**
 * PCA-RUNTIME-PERSIST-1 Section 6: real Room bridge for legitimate usage
 * observations. `record` is `@Insert(REPLACE)`-backed (idempotent on [id] --
 * re-delivering the same observation after a process restart or duplicate
 * producer tick upserts the same row rather than duplicating it) and safe to
 * call out of chronological order (`getForDevice` always re-sorts by
 * `startedAtEpochMillis`, not insertion order). The app/category token is
 * encrypted at rest (PCA-LOCAL-DB-1 Section 8) since it can be
 * family-sensitive (doc 10 Section 4.1).
 */
class UsageSessionRepository(
    private val dao: UsageSessionDao,
    private val cipher: LocalRecordCipher,
) {
    suspend fun record(
        id: String,
        deviceId: String,
        appOrCategoryToken: String,
        startedAtEpochMillis: Long,
        endedAtEpochMillis: Long,
        durationMillis: Long,
        sourceConfidence: SourceConfidence,
    ) {
        val (tokenEnc, tokenIv) = cipher.encryptToColumns(appOrCategoryToken)
        dao.upsert(
            UsageSessionEntity(
                id = id,
                deviceId = deviceId,
                appOrCategoryTokenEnc = tokenEnc,
                appOrCategoryTokenIv = tokenIv,
                startedAtEpochMillis = startedAtEpochMillis,
                endedAtEpochMillis = endedAtEpochMillis,
                durationMillis = durationMillis,
                sourceConfidence = sourceConfidence,
            ),
        )
    }

    suspend fun getForDevice(deviceId: String): List<UsageSession> =
        dao.getForDevice(deviceId).map { it.toDomain(cipher) }

    private fun UsageSessionEntity.toDomain(cipher: LocalRecordCipher): UsageSession = UsageSession(
        id = id,
        deviceId = deviceId,
        appOrCategoryToken = cipher.decryptFromColumns(appOrCategoryTokenEnc, appOrCategoryTokenIv),
        startedAtEpochMillis = startedAtEpochMillis,
        endedAtEpochMillis = endedAtEpochMillis,
        durationMillis = durationMillis,
        sourceConfidence = sourceConfidence,
    )
}
