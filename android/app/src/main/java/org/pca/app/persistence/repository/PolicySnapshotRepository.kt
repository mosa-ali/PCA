package org.pca.app.persistence.repository

import org.pca.app.persistence.crypto.LocalRecordCipher
import org.pca.app.persistence.crypto.decryptFromColumns
import org.pca.app.persistence.crypto.encryptToColumns
import org.pca.app.persistence.dao.PolicySnapshotDao
import org.pca.app.persistence.entity.PolicySnapshotEntity

/** Plaintext view of an accepted [PolicySnapshotEntity] -- the repository is the only place ciphertext round-trips to plaintext. */
data class AcceptedPolicy(
    val policyId: String,
    val childDeviceId: String,
    val version: Long,
    val effectiveFromEpochMillis: Long,
    val expiresAtEpochMillis: Long?,
    val payload: String,
    val trustSetEpoch: Long,
    val keyEpoch: Long,
    val signedByKeyId: String,
    val receivedAtEpochMillis: Long,
    val appliedAtEpochMillis: Long?,
    val applicationResult: String,
)

sealed class SavePolicyResult {
    data class Accepted(val policy: AcceptedPolicy) : SavePolicyResult()
    data class DuplicateIgnored(val version: Long) : SavePolicyResult()
    data class RolledBackRejected(val attemptedVersion: Long, val currentVersion: Long) : SavePolicyResult()
}

/**
 * PCA-RUNTIME-PERSIST-1 Sections 4/5/9: durable storage adapter for the last
 * accepted family policy / PolicySnapshot (Section 4), reused as-is for the
 * schedule cache (Section 5 -- "prefer reuse of PolicySnapshot where
 * appropriate. Do not create parallel policy authority.") and for
 * persisting rejected/stale/epoch-mismatch application outcomes so
 * reconnect can report real application status to the parent (Section 9).
 *
 * The encrypted payload is opaque to this repository too: it only
 * wraps/unwraps the caller-supplied payload string with [LocalRecordCipher]
 * as this device's own local-at-rest layer (defense in depth; decoding a
 * signed Policy payload is the policy-application layer's job, doc 05
 * Section 6, which this class does not do).
 *
 * `save` enforces strict monotonic `version` per `childDeviceId` -- a
 * version at or below the currently accepted one is never allowed to
 * become (or silently overwrite) the latest-valid row: an exact-duplicate
 * retry is a no-op ([DuplicateIgnored]), a genuine rollback attempt is
 * persisted as non-latest history via [insertIgnoreConflict] rather than
 * silently dropped, so a rebooted, offline child device can always recover
 * its last accepted policy (Section 4) even after a stale/rollback attempt
 * reaches it.
 */
class PolicySnapshotRepository(
    private val dao: PolicySnapshotDao,
    private val cipher: LocalRecordCipher,
) {
    suspend fun save(
        policyId: String,
        childDeviceId: String,
        version: Long,
        effectiveFromEpochMillis: Long,
        expiresAtEpochMillis: Long?,
        payload: String,
        trustSetEpoch: Long,
        keyEpoch: Long,
        signedByKeyId: String,
        receivedAtEpochMillis: Long,
        appliedAtEpochMillis: Long?,
        applicationResult: String = "APPLIED",
    ): SavePolicyResult {
        val currentMax = dao.getMaxVersion(childDeviceId) ?: -1L
        if (version == currentMax) return SavePolicyResult.DuplicateIgnored(version)
        if (version < currentMax) {
            recordRejectedOrStaleAttempt(
                policyId, childDeviceId, version, effectiveFromEpochMillis, expiresAtEpochMillis,
                payload, trustSetEpoch, keyEpoch, signedByKeyId, receivedAtEpochMillis, "ROLLBACK_REJECTED",
            )
            return SavePolicyResult.RolledBackRejected(attemptedVersion = version, currentVersion = currentMax)
        }

        val (payloadEnc, payloadIv) = cipher.encryptToColumns(payload)
        dao.clearLatestFlag(childDeviceId)
        dao.insert(
            PolicySnapshotEntity(
                policyId = policyId,
                childDeviceId = childDeviceId,
                version = version,
                effectiveFromEpochMillis = effectiveFromEpochMillis,
                expiresAtEpochMillis = expiresAtEpochMillis,
                encryptedPayloadEnc = payloadEnc,
                encryptedPayloadIv = payloadIv,
                trustSetEpoch = trustSetEpoch,
                keyEpoch = keyEpoch,
                signedByKeyId = signedByKeyId,
                receivedAtEpochMillis = receivedAtEpochMillis,
                appliedAtEpochMillis = appliedAtEpochMillis,
                applicationResult = applicationResult,
                isLatestValid = true,
            ),
        )
        return SavePolicyResult.Accepted(
            AcceptedPolicy(
                policyId, childDeviceId, version, effectiveFromEpochMillis, expiresAtEpochMillis,
                payload, trustSetEpoch, keyEpoch, signedByKeyId, receivedAtEpochMillis,
                appliedAtEpochMillis, applicationResult,
            ),
        )
    }

    /**
     * Section 9: persists a stale-epoch/trust-set-epoch-mismatch outcome
     * detected upstream (this repository does not itself verify epochs) as
     * non-latest history at [version], so reconnect can still report that a
     * specific policy version was received but rejected. Never flips
     * `isLatestValid` -- the previously accepted policy remains recoverable.
     */
    suspend fun recordRejectedOrStaleAttempt(
        policyId: String,
        childDeviceId: String,
        version: Long,
        effectiveFromEpochMillis: Long,
        expiresAtEpochMillis: Long?,
        payload: String,
        trustSetEpoch: Long,
        keyEpoch: Long,
        signedByKeyId: String,
        receivedAtEpochMillis: Long,
        outcome: String,
    ) {
        val (payloadEnc, payloadIv) = cipher.encryptToColumns(payload)
        dao.insertIgnoreConflict(
            PolicySnapshotEntity(
                policyId = policyId,
                childDeviceId = childDeviceId,
                version = version,
                effectiveFromEpochMillis = effectiveFromEpochMillis,
                expiresAtEpochMillis = expiresAtEpochMillis,
                encryptedPayloadEnc = payloadEnc,
                encryptedPayloadIv = payloadIv,
                trustSetEpoch = trustSetEpoch,
                keyEpoch = keyEpoch,
                signedByKeyId = signedByKeyId,
                receivedAtEpochMillis = receivedAtEpochMillis,
                appliedAtEpochMillis = null,
                applicationResult = outcome,
                isLatestValid = false,
            ),
        )
    }

    suspend fun loadLatestAccepted(childDeviceId: String): AcceptedPolicy? =
        dao.getLatestValid(childDeviceId)?.toDomain(cipher)

    suspend fun currentRevision(childDeviceId: String): Long? = dao.getMaxVersion(childDeviceId)

    suspend fun deleteForDevice(childDeviceId: String): Int = dao.deleteAllForDevice(childDeviceId)

    // Section 5's schedule cache is a distinct conceptual use of the same
    // PolicySnapshot authority above, not a second table -- these are thin,
    // intention-revealing aliases only.
    suspend fun saveAcceptedSchedulePolicy(
        policyId: String,
        childDeviceId: String,
        version: Long,
        effectiveFromEpochMillis: Long,
        expiresAtEpochMillis: Long?,
        payload: String,
        trustSetEpoch: Long,
        keyEpoch: Long,
        signedByKeyId: String,
        receivedAtEpochMillis: Long,
        appliedAtEpochMillis: Long?,
    ): SavePolicyResult = save(
        policyId, childDeviceId, version, effectiveFromEpochMillis, expiresAtEpochMillis,
        payload, trustSetEpoch, keyEpoch, signedByKeyId, receivedAtEpochMillis, appliedAtEpochMillis,
    )

    suspend fun loadLatestAcceptedSchedulePolicy(childDeviceId: String): AcceptedPolicy? = loadLatestAccepted(childDeviceId)

    suspend fun deleteSchedulePolicy(childDeviceId: String): Int = deleteForDevice(childDeviceId)

    private fun PolicySnapshotEntity.toDomain(cipher: LocalRecordCipher): AcceptedPolicy = AcceptedPolicy(
        policyId = policyId,
        childDeviceId = childDeviceId,
        version = version,
        effectiveFromEpochMillis = effectiveFromEpochMillis,
        expiresAtEpochMillis = expiresAtEpochMillis,
        payload = cipher.decryptFromColumns(encryptedPayloadEnc, encryptedPayloadIv),
        trustSetEpoch = trustSetEpoch,
        keyEpoch = keyEpoch,
        signedByKeyId = signedByKeyId,
        receivedAtEpochMillis = receivedAtEpochMillis,
        appliedAtEpochMillis = appliedAtEpochMillis,
        applicationResult = applicationResult,
    )
}
