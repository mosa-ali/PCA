package org.pca.app.runtime.sync

import org.pca.app.runtime.sync.outbox.OutboxItem
import org.pca.app.runtime.sync.outbox.SyncOutboxPort

internal enum class FakeState { PENDING, SENT }

internal data class FakeRow(
    val messageId: String,
    val familyScope: String,
    val recipientScope: String,
    val envelopeCiphertextBase64: String,
    val sequence: Long,
    val expiresAtEpochMillis: Long,
    var state: FakeState,
    var retryCount: Int,
    var nextRetryAtEpochMillis: Long?,
)

/**
 * Fake, in-memory storage port (doc 40 Section 21 -- "integration-style
 * test with fake storage port... Agent 12 later provides real Room
 * implementation"). [FakeDurableBackingStore] represents "disk": multiple
 * [FakeSyncOutboxPort] instances constructed against the SAME backing
 * store simulate destroying and recreating the runtime while state
 * persists, exactly like [org.pca.app.runtime.sync.outbox.SyncOutboxRepositoryAdapter]
 * over a real closed/reopened Room DB would.
 */
class FakeDurableBackingStore {
    internal val rowsByMessageId = LinkedHashMap<String, FakeRow>()
}

class FakeSyncOutboxPort(private val store: FakeDurableBackingStore) : SyncOutboxPort {

    override suspend fun enqueue(
        messageId: String,
        familyScope: String,
        recipientScope: String,
        envelopeCiphertextBase64: String,
        sequence: Long,
        expiresAtEpochMillis: Long,
        createdAtEpochMillis: Long,
    ): Boolean {
        if (store.rowsByMessageId.containsKey(messageId)) return false
        store.rowsByMessageId[messageId] = FakeRow(
            messageId, familyScope, recipientScope, envelopeCiphertextBase64, sequence, expiresAtEpochMillis,
            FakeState.PENDING, retryCount = 0, nextRetryAtEpochMillis = null,
        )
        return true
    }

    override suspend fun getReadyForDelivery(nowEpochMillis: Long): List<OutboxItem> =
        store.rowsByMessageId.values
            .filter { it.state == FakeState.PENDING && (it.nextRetryAtEpochMillis == null || it.nextRetryAtEpochMillis!! <= nowEpochMillis) }
            .sortedBy { it.sequence }
            .map { OutboxItem(it.messageId, it.familyScope, it.recipientScope, it.envelopeCiphertextBase64, it.sequence, it.expiresAtEpochMillis, it.retryCount) }

    override suspend fun markSent(messageId: String) {
        store.rowsByMessageId[messageId]?.state = FakeState.SENT
    }

    override suspend fun markFailedForRetry(messageId: String, nextRetryAtEpochMillis: Long) {
        val row = store.rowsByMessageId[messageId] ?: return
        row.retryCount += 1
        row.nextRetryAtEpochMillis = nextRetryAtEpochMillis
    }

    override suspend fun deleteExpired(nowEpochMillis: Long) {
        store.rowsByMessageId.values.removeAll { it.expiresAtEpochMillis <= nowEpochMillis }
    }
}
