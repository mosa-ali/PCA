package org.pca.app.persistence.sync

import org.pca.app.persistence.entity.SyncOutboxRecordEntity

/**
 * AGENT16_STORAGE_INTERFACE (PCA-RUNTIME-PERSIST-1 Section 11): the exact
 * set of storage primitives this lane guarantees to whichever component
 * owns the reconnect/sync state machine and backoff algorithm (per the
 * lane brief, "Agent 16"). This module owns durable storage only -- no
 * reconnect networking logic, no backoff timing decisions -- those live on
 * the other side of this interface. [SyncOutboxRepository] is the
 * production implementation.
 */
interface OutboxSyncStorage {
    /** Pending rows (across all families) whose retry backoff has elapsed, most urgent first (Section 13). */
    suspend fun getReadyForDelivery(nowEpochMillis: Long): List<Pair<SyncOutboxRecordEntity, String>>

    /** State transition after a successful send, prior to the remote ack (kept as row history). */
    suspend fun markSent(messageId: String)

    /** Retry bookkeeping: increments `retryCount`, schedules `nextRetryAtEpochMillis` (Section 15 -- backoff timing itself is the caller's algorithm). */
    suspend fun markFailedForRetry(messageId: String, nextRetryAtEpochMillis: Long)

    /** Explicit acknowledgement/removal once the remote side has confirmed receipt (Section 11). */
    suspend fun acknowledgeAndRemove(messageId: String)

    /** Local expiry sweep (Section 19: retention continues even while offline). */
    suspend fun deleteExpired(nowEpochMillis: Long): Int

    /** Queue-size/pressure metrics for backoff/backpressure decisions (Section 11/12). */
    suspend fun pendingCount(): Int
    suspend fun pendingCountForFamily(familyScope: String): Int
    suspend fun pendingByteSize(): Long
}
