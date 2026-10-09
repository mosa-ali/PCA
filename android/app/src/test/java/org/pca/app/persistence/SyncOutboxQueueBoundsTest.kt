package org.pca.app.persistence

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.pca.app.persistence.crypto.encryptToColumns
import org.pca.app.persistence.dao.SyncOutboxDao
import org.pca.app.persistence.sync.EnqueueOutcome
import org.pca.app.persistence.sync.OutboxPriority
import org.pca.app.persistence.sync.OutboxQueueBounds
import org.pca.app.persistence.sync.SyncOutboxRepository
import org.pca.app.persistence.entity.SyncOutboxState
import org.robolectric.RobolectricTestRunner
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

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

    @Test
    fun `concurrent repository wrappers sharing a DAO keep all bounds after database reopen`() = runTest {
        val fileName = "outbox_concurrent_bounds.db"
        val context = PersistenceTestSupport.context()
        context.deleteDatabase(fileName)

        val cipher = PersistenceTestSupport.testCipher()
        // Both messages have this exact plaintext length, so one row reaches
        // but does not exceed the ciphertext-byte limit and two rows exceed it.
        val maxBytes = cipher.encryptToColumns("same-size").first.length.toLong()
        val bounds = OutboxQueueBounds(maxTotalRecords = 1, maxTotalBytes = maxBytes, maxPerFamily = 1)
        val firstDb = PersistenceTestSupport.fileBackedDb(fileName)
        val raceProbe = ConcurrentZeroFamilySnapshotDao(firstDb.syncOutboxDao())
        val firstRepository = SyncOutboxRepository(raceProbe, cipher, bounds)
        val secondRepository = SyncOutboxRepository(raceProbe, cipher, bounds)
        val bothReady = CountDownLatch(2)
        val startTogether = CountDownLatch(1)

        try {
            val outcomes = coroutineScope {
                listOf(
                    async(Dispatchers.IO) {
                        bothReady.countDown()
                        check(startTogether.await(3, TimeUnit.SECONDS)) { "outbox_concurrency_start_timeout" }
                        firstRepository.enqueue(
                            "message-a", "family-a", "device-a", "same-size",
                            1L, 999_999L, 1_000L,
                        )
                    },
                    async(Dispatchers.IO) {
                        bothReady.countDown()
                        check(startTogether.await(3, TimeUnit.SECONDS)) { "outbox_concurrency_start_timeout" }
                        secondRepository.enqueue(
                            "message-b", "family-a", "device-a", "same-size",
                            2L, 999_999L, 1_000L,
                        )
                    },
                ).also {
                    assertTrue("both enqueue callers should be ready", bothReady.await(3, TimeUnit.SECONDS))
                    startTogether.countDown()
                }.awaitAll()
            }

            assertEquals(1, outcomes.count { it == EnqueueOutcome.ENQUEUED })
            assertEquals(1, outcomes.count { it == EnqueueOutcome.REJECTED_QUEUE_FULL })
            // Exactly one caller observed an empty family snapshot and waited
            // at the gate; the second wrapper could not enter the same
            // read/modify/write sequence while the first held the DAO lock.
            assertEquals(1, raceProbe.emptyFamilySnapshots.get())
            assertEquals(1, raceProbe.gateTimeouts.get())
            assertEquals(1, firstDb.syncOutboxDao().countByState(SyncOutboxState.PENDING))
            assertEquals(1, firstDb.syncOutboxDao().countByFamilyAndState("family-a", SyncOutboxState.PENDING))
            assertTrue(firstDb.syncOutboxDao().totalCiphertextLengthByState(SyncOutboxState.PENDING) <= maxBytes)
        } finally {
            firstDb.close()
        }

        val reopened = PersistenceTestSupport.fileBackedDb(fileName)
        try {
            assertEquals(1, reopened.syncOutboxDao().countByState(SyncOutboxState.PENDING))
            assertEquals(1, reopened.syncOutboxDao().countByFamilyAndState("family-a", SyncOutboxState.PENDING))
            assertTrue(reopened.syncOutboxDao().totalCiphertextLengthByState(SyncOutboxState.PENDING) <= maxBytes)
            assertEquals(1, listOf("message-a", "message-b").count { reopened.syncOutboxDao().getById(it) != null })
        } finally {
            reopened.close()
            context.deleteDatabase(fileName)
        }
    }

    /** Holds two stale empty-family observations together if repository writes are not serialized. */
    private class ConcurrentZeroFamilySnapshotDao(
        private val delegate: SyncOutboxDao,
    ) : SyncOutboxDao by delegate {
        private val zeroFamilyReaders = CountDownLatch(2)
        private val observedEmptyFamilyCount = AtomicInteger()
        val emptyFamilySnapshots = AtomicInteger()
        val gateTimeouts = AtomicInteger()

        override suspend fun countByFamilyAndState(familyScope: String, state: SyncOutboxState): Int {
            val count = delegate.countByFamilyAndState(familyScope, state)
            if (count == 0 && observedEmptyFamilyCount.getAndIncrement() < 2) {
                emptyFamilySnapshots.incrementAndGet()
                zeroFamilyReaders.countDown()
                if (!zeroFamilyReaders.await(2, TimeUnit.SECONDS)) gateTimeouts.incrementAndGet()
            }
            return count
        }
    }
}
