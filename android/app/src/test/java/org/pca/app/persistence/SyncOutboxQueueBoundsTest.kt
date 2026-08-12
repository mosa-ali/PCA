package org.pca.app.persistence

import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.pca.app.persistence.sync.EnqueueOutcome
import org.pca.app.persistence.sync.OutboxPriority
import org.pca.app.persistence.sync.OutboxQueueBounds
import org.pca.app.persistence.sync.SyncOutboxRepository
import org.robolectric.RobolectricTestRunner

/**
 * PCA-RUNTIME-PERSIST-1 Sections 12-14: a bounded outbox must never let a
 * lower-priority message silently push out an equally-or-more-important
 * one, but MUST let a security/policy message evict room for itself among
 * lower-priority pending messages. Also covers aggregation/coalescing.
 */
@RunWith(RobolectricTestRunner::class)
class SyncOutboxQueueBoundsTest {
    private lateinit var db: PcaLocalDatabase

    @Before
    fun setUp() {
        db = PersistenceTestSupport.inMemoryDb()
    }

    @After
    fun tearDown() {
        db.close()
    }

    private fun repo(maxTotalRecords: Int = 3) = SyncOutboxRepository(
        db.syncOutboxDao(),
        PersistenceTestSupport.testCipher(),
        OutboxQueueBounds(maxTotalRecords = maxTotalRecords, maxTotalBytes = Long.MAX_VALUE, maxPerFamily = maxTotalRecords),
    )

    @Test
    fun `a full queue rejects a new low-priority message rather than evicting an equally important one`() = runTest {
        val outbox = repo(maxTotalRecords = 2)
        outbox.enqueue("msg-1", "family-1", "device-1", "e1", 1L, 999_999L, 1000L, priority = OutboxPriority.SECURITY_TRUST)
        outbox.enqueue("msg-2", "family-1", "device-1", "e2", 2L, 999_999L, 1000L, priority = OutboxPriority.SECURITY_TRUST)

        val outcome = outbox.enqueue("msg-3", "family-1", "device-1", "e3", 3L, 999_999L, 1000L, priority = OutboxPriority.ACTIVITY_SUMMARY)

        assertEquals(EnqueueOutcome.REJECTED_QUEUE_FULL, outcome)
        assertEquals(2, outbox.pendingCount())
        assertNotNull(db.syncOutboxDao().getById("msg-1"))
        assertNotNull(db.syncOutboxDao().getById("msg-2"))
        assertNull(db.syncOutboxDao().getById("msg-3"))
    }

    @Test
    fun `a security-priority message evicts the oldest lower-priority pending message to make room`() = runTest {
        val outbox = repo(maxTotalRecords = 2)
        outbox.enqueue("msg-old", "family-1", "device-1", "e1", 1L, 999_999L, 1000L, priority = OutboxPriority.ACTIVITY_SUMMARY)
        outbox.enqueue("msg-new", "family-1", "device-1", "e2", 2L, 999_999L, 1000L, priority = OutboxPriority.ACTIVITY_SUMMARY)

        val outcome = outbox.enqueue("msg-security", "family-1", "device-1", "e3", 3L, 999_999L, 1000L, priority = OutboxPriority.SECURITY_TRUST)

        assertEquals(EnqueueOutcome.ENQUEUED, outcome)
        assertEquals(2, outbox.pendingCount())
        assertNull("the oldest low-priority message must be the one evicted", db.syncOutboxDao().getById("msg-old"))
        assertNotNull(db.syncOutboxDao().getById("msg-new"))
        assertNotNull(db.syncOutboxDao().getById("msg-security"))
    }

    @Test
    fun `messages with the same coalesce key merge into one pending row instead of queuing one per tick`() = runTest {
        val outbox = repo()

        val first = outbox.enqueue("msg-1", "family-1", "device-1", "usage-summary-v1", 1L, 999_999L, 1000L, coalesceKey = "usage:device-1:hour-1")
        val second = outbox.enqueue("msg-2", "family-1", "device-1", "usage-summary-v2", 2L, 999_999L, 2000L, coalesceKey = "usage:device-1:hour-1")

        assertEquals(EnqueueOutcome.ENQUEUED, first)
        assertEquals(EnqueueOutcome.COALESCED, second)
        assertEquals(1, outbox.pendingCount())
        assertEquals("usage-summary-v2", outbox.getReadyForDelivery(3000L).single().second)
    }

    @Test
    fun `getReadyForDelivery orders the most urgent messages first regardless of enqueue order`() = runTest {
        val outbox = repo(maxTotalRecords = 10)
        outbox.enqueue("msg-summary", "family-1", "device-1", "e1", 1L, 999_999L, 1000L, priority = OutboxPriority.ACTIVITY_SUMMARY)
        outbox.enqueue("msg-security", "family-1", "device-1", "e2", 2L, 999_999L, 1000L, priority = OutboxPriority.SECURITY_TRUST)

        val ready = outbox.getReadyForDelivery(2000L)

        assertEquals("msg-security", ready.first().first.messageId)
    }
}
