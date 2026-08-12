package org.pca.app.runtime.sync.outbox

import org.pca.app.persistence.sync.EnqueueOutcome
import org.pca.app.persistence.sync.SyncOutboxRepository

/**
 * Production adapter -- wraps Agent-12's real, Room-backed SyncOutboxRepository 1:1. See SyncOutboxPort's doc comment for the message-type ordering gap this adapter inherits.
 *
 * Coordinator integration fix: Agent 12's corrected [SyncOutboxRepository.enqueue] returns the richer
 * [EnqueueOutcome] (ENQUEUED/ALREADY_QUEUED/COALESCED/REJECTED_QUEUE_FULL) added by its own accepted
 * priority-aware bounded-queue eviction logic -- a change [SyncOutboxPort]'s plain-`Boolean` contract
 * (Agent 16's own interface) never saw during isolated lane development. This adapter maps that outcome
 * onto the port's existing "was the message accepted into the queue" semantics: only the bounded-queue
 * rejection is `false`; an already-queued/coalesced message is still queued, so it is `true`.
 */
class SyncOutboxRepositoryAdapter(private val repository: SyncOutboxRepository) : SyncOutboxPort {

    override suspend fun enqueue(
        messageId: String,
        familyScope: String,
        recipientScope: String,
        envelopeCiphertextBase64: String,
        sequence: Long,
        expiresAtEpochMillis: Long,
        createdAtEpochMillis: Long,
    ): Boolean = when (
        repository.enqueue(messageId, familyScope, recipientScope, envelopeCiphertextBase64, sequence, expiresAtEpochMillis, createdAtEpochMillis)
    ) {
        EnqueueOutcome.REJECTED_QUEUE_FULL -> false
        EnqueueOutcome.ENQUEUED, EnqueueOutcome.ALREADY_QUEUED, EnqueueOutcome.COALESCED -> true
    }

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
