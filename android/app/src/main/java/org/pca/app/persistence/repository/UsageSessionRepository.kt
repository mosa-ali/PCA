package org.pca.app.persistence.repository

import org.pca.app.runtime.usage.UsageSessionProvenance
import org.pca.app.runtime.usage.UsageSessionProvenanceCodec
import org.pca.app.runtime.usage.UsageProvenanceBinding
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
    val observationProvenance: UsageSessionProvenance? = null,
)

/** Truncation explicitly describes this retained-row query, never platform coverage. */
data class UsageObservationPage(val sessions: List<UsageSession>, val truncated: Boolean)

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
        observationProvenance: UsageSessionProvenance? = null,
    ) {
        val provenance = observationProvenance?.let {
            require(sourceConfidence == SourceConfidence.PLATFORM_API)
            cipher.encryptToColumns(UsageSessionProvenanceCodec.encode(
                UsageProvenanceBinding(id, deviceId, appOrCategoryToken,
                    startedAtEpochMillis, endedAtEpochMillis, durationMillis), it))
        }
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
                observationProvenanceEnc = provenance?.first,
                observationProvenanceIv = provenance?.second,
            ),
        )
    }

    suspend fun getForDevice(deviceId: String): List<UsageSession> =
        dao.getForDevice(deviceId).map { entity ->
            check(entity.deviceId == deviceId) {
                "Usage session DAO returned a row outside the requested device scope"
            }
            entity.toDomain(cipher)
        }

    /**
     * Retention-bounded query for export/reporting. The cutoff is applied by Room before any
     * encrypted app token or provenance is decrypted, so expired rows cannot enter plaintext
     * processing merely because the periodic deletion worker has not run yet.
     */
    suspend fun getForDeviceSince(deviceId: String, cutoffEpochMillis: Long): List<UsageSession> {
        require(deviceId.isNotBlank())
        return dao.getForDeviceSince(deviceId, cutoffEpochMillis).map { entity ->
            check(entity.deviceId == deviceId && entity.startedAtEpochMillis >= cutoffEpochMillis) {
                "Usage session DAO violated requested device or retention scope"
            }
            entity.toDomain(cipher)
        }
    }

    /** Bounded read-only local observations. Missing metadata is legacy/unknown;
     * malformed present metadata fails the read rather than becoming qualified capture. */
    suspend fun getRecentObservations(deviceId: String, limit: Int): UsageObservationPage {
        require(deviceId.isNotBlank() && limit in 1..256)
        val rows = dao.getRecentForDevice(deviceId, limit + 1)
        check(rows.size <= limit + 1 && rows.all { it.deviceId == deviceId }) {
            "Usage observation DAO violated query bounds or device scope"
        }
        return UsageObservationPage(rows.take(limit).map { it.toDomain(cipher) }, rows.size > limit)
    }

    private fun UsageSessionEntity.toDomain(cipher: LocalRecordCipher): UsageSession {
        val token = cipher.decryptFromColumns(appOrCategoryTokenEnc, appOrCategoryTokenIv)
        check((observationProvenanceEnc == null) == (observationProvenanceIv == null)) {
            "Usage observation metadata unavailable"
        }
        val provenance = observationProvenanceEnc?.let { encrypted ->
            check(sourceConfidence == SourceConfidence.PLATFORM_API)
            check(encrypted.length <= 32768 && observationProvenanceIv!!.length <= 128) {
                "Usage observation metadata unavailable"
            }
            UsageSessionProvenanceCodec.decode(
                UsageProvenanceBinding(id, deviceId, token, startedAtEpochMillis, endedAtEpochMillis, durationMillis),
                cipher.decryptFromColumns(encrypted, observationProvenanceIv!!))
        }
        return UsageSession(
            id = id,
            deviceId = this.deviceId,
            appOrCategoryToken = token,
            startedAtEpochMillis = startedAtEpochMillis,
            endedAtEpochMillis = endedAtEpochMillis,
            durationMillis = durationMillis,
            sourceConfidence = sourceConfidence,
            observationProvenance = provenance,
        )
    }
}
