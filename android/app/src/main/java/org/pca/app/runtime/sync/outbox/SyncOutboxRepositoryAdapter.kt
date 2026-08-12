package org.pca.app.runtime.sync.outbox

import org.pca.app.persistence.sync.SyncOutboxRepository

/** Production adapter -- wraps Agent-12's real, Room-backed SyncOutboxRepository 1:1. See SyncOutboxPort's doc comment for the message-type ordering gap this adapter inherits. */
class SyncOutboxRepositoryAdapter(private val repository: SyncOutboxRepository) : SyncOutboxPort {

    override suspend fun enqueue(
        messageId: String,
        familyScope: String,
        recipientScope: String,
        envelopeCiphertextBase64: String,
        sequence: Long,
        expiresAtEpochMillis: Long,
        createdAtEpochMillis: Long,
    ): Boolean = repository.enqueue(messageId, familyScope, recipientScope, envelopeCiphertextBase64, sequence, expiresAtEpochMillis, createdAtEpochMillis)

    override suspend fun getReadyForDelivery(nowEpochMillis: Long): List<OutboxItem> =
        repository.getReadyForDelivery(nowEpochMillis).map { (entity, ciphertext) ->
            OutboxItem(
                messageId = entity.messageId,
                familyScope = entity.familyScope,
                recipientScope = entity.recipientScope,
                envelopeCiphertextBase64 = ciphertext,
                sequence = entity.sequence,
                expiresAtEpochMillis = entity.expiresAtEpochMillis,
                retryCount = entity.retryCount,
            )
        }

    override suspend fun markSent(messageId: String) {
        repository.markSent(messageId)
    }

    override suspend fun markFailedForRetry(messageId: String, nextRetryAtEpochMillis: Long) {
        repository.markFailedForRetry(messageId, nextRetryAtEpochMillis)
    }

    override suspend fun deleteExpired(nowEpochMillis: Long) {
        repository.deleteExpired(nowEpochMillis)
    }
}
