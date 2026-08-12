package org.pca.app.runtime.sync.outbox

/**
 * Narrow abstraction over Agent-12's `org.pca.app.persistence.sync.SyncOutboxRepository`
 * (PCA-LOCAL-DB-1) -- deliberately this lane's OWN interface, not a direct
 * dependency on the concrete Room-backed repository, so this module's own
 * tests can run against a deterministic fake storage port (doc 40 Section
 * 21) without needing Room/Robolectric. [SyncOutboxRepositoryAdapter] wraps
 * the real repository 1:1; nothing here reimplements persistence,
 * encryption, or idempotency -- all of that is Agent-12's.
 *
 * KNOWN GAP, documented rather than papered over: `SyncOutboxRecordEntity`
 * (PCA-LOCAL-DB-1, org.pca.app.persistence, out of this lane's
 * ownership) has no message-type column, so
 * `priority.PriorityPolicy`'s per-messageType tier ordering cannot be
 * wired through the REAL outbox -- `getReadyForDelivery` is ordered by
 * `sequence` only (SyncOutboxDao's own ordering), which is what
 * [ReconnectSyncOrchestrator] uses for the real adapter. PriorityPolicy
 * remains available, independently tested, for any caller that DOES have
 * per-item message-type metadata (e.g. a future outbox schema revision, or
 * the backend/parent-sdk sides, which do store it) -- adding a
 * message-type column here would be a schema change this lane may not make
 * unilaterally (PCA-16 lane brief Section 27).
 */
data class OutboxItem(
    val messageId: String,
    val familyScope: String,
    val recipientScope: String,
    /** The E2EE envelope ciphertext, base64 -- opaque to this module, exactly as it is to SyncOutboxRepository itself. */
    val envelopeCiphertextBase64: String,
    val sequence: Long,
    val expiresAtEpochMillis: Long,
    val retryCount: Int,
)

interface SyncOutboxPort {
    suspend fun enqueue(
        messageId: String,
        familyScope: String,
        recipientScope: String,
        envelopeCiphertextBase64: String,
        sequence: Long,
        expiresAtEpochMillis: Long,
        createdAtEpochMillis: Long,
    ): Boolean

    suspend fun getReadyForDelivery(nowEpochMillis: Long): List<OutboxItem>
    suspend fun markSent(messageId: String)
    suspend fun markFailedForRetry(messageId: String, nextRetryAtEpochMillis: Long)
    suspend fun deleteExpired(nowEpochMillis: Long)
}
