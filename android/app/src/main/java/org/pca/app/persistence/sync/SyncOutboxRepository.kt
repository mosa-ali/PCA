package org.pca.app.persistence.sync

import org.pca.app.persistence.crypto.LocalRecordCipher
import org.pca.app.persistence.crypto.decryptFromColumns
import org.pca.app.persistence.crypto.encryptToColumns
import org.pca.app.persistence.dao.SyncOutboxDao
import org.pca.app.persistence.entity.SyncOutboxRecordEntity
import org.pca.app.persistence.entity.SyncOutboxState

/**
 * doc 09 Section 5.1 / PCA-LOCAL-DB-1 Section 18. `envelopeCiphertext` is
 * the ALREADY E2EE-encrypted outbound envelope (opaque bytes from the
 * family key hierarchy, doc 09) -- this repository wraps it with a second,
 * local-at-rest [LocalRecordCipher] layer before it ever reaches Room, so a
 * copy of the local DB file alone is not sufficient to read a queued
 * message even before it leaves the device.
 */
class SyncOutboxRepository(
    private val dao: SyncOutboxDao,
    private val cipher: LocalRecordCipher,
) {
    /** Returns true if a new row was enqueued, false if [messageId] was already queued (idempotent). */
    suspend fun enqueue(
        messageId: String,
        familyScope: String,
        recipientScope: String,
        envelopeCiphertextBase64: String,
        sequence: Long,
        expiresAtEpochMillis: Long,
        createdAtEpochMillis: Long,
    ): Boolean {
        val (enc, iv) = cipher.encryptToColumns(envelopeCiphertextBase64)
        val rowId = dao.enqueue(
            SyncOutboxRecordEntity(
                messageId = messageId,
                familyScope = familyScope,
                recipientScope = recipientScope,
                envelopeCipherEnc = enc,
                envelopeCipherIv = iv,
                sequence = sequence,
                state = SyncOutboxState.PENDING,
                retryCount = 0,
                nextRetryAtEpochMillis = null,
                expiresAtEpochMillis = expiresAtEpochMillis,
                createdAtEpochMillis = createdAtEpochMillis,
            ),
        )
        return rowId != -1L
    }

    suspend fun getReadyForDelivery(nowEpochMillis: Long): List<Pair<SyncOutboxRecordEntity, String>> =
        dao.getReadyForDelivery(SyncOutboxState.PENDING, nowEpochMillis).map {
            it to cipher.decryptFromColumns(it.envelopeCipherEnc, it.envelopeCipherIv)
        }

    suspend fun markSent(messageId: String) = dao.updateState(messageId, SyncOutboxState.SENT)

    suspend fun markFailedForRetry(messageId: String, nextRetryAtEpochMillis: Long) =
        dao.markRetry(messageId, SyncOutboxState.PENDING, nextRetryAtEpochMillis)

    suspend fun deleteExpired(nowEpochMillis: Long) = dao.deleteExpired(nowEpochMillis)
}
