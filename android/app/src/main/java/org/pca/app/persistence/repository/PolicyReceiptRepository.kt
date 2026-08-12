package org.pca.app.persistence.repository

import org.pca.app.persistence.dao.PolicyReceiptDao
import org.pca.app.persistence.entity.PolicyReceiptEntity

/**
 * PCA-RUNTIME-PERSIST-1 Section 9: thin repository over
 * [PolicyReceiptDao] for the signed "verified and applied" status receipt
 * (doc 10 Section 5) -- lets the parent UI distinguish "edit sent" from
 * "edit confirmed applied" once the device reconnects. `record` is
 * `@Insert(IGNORE)`-backed on the `(deviceId, policyVersion)` unique index,
 * so re-reporting the same applied version after a process restart is a
 * no-op, not a duplicate receipt.
 */
class PolicyReceiptRepository(private val dao: PolicyReceiptDao) {
    suspend fun record(
        id: String,
        deviceId: String,
        policyId: String,
        policyVersion: Long,
        verifiedAtEpochMillis: Long,
        appliedAtEpochMillis: Long,
        signedByKeyId: String,
    ): Boolean {
        val rowId = dao.insert(
            PolicyReceiptEntity(
                id = id,
                deviceId = deviceId,
                policyId = policyId,
                policyVersion = policyVersion,
                verifiedAtEpochMillis = verifiedAtEpochMillis,
                appliedAtEpochMillis = appliedAtEpochMillis,
                signedByKeyId = signedByKeyId,
            ),
        )
        return rowId != -1L
    }

    suspend fun getForDevice(deviceId: String): List<PolicyReceiptEntity> = dao.getForDevice(deviceId)

    suspend fun getForDeviceAndVersion(deviceId: String, version: Long): PolicyReceiptEntity? =
        dao.getForDeviceAndVersion(deviceId, version)
}
