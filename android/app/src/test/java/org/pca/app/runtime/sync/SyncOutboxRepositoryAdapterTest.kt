package org.pca.app.runtime.sync

import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.pca.app.persistence.PcaLocalDatabase
import org.pca.app.persistence.PersistenceTestSupport
import org.pca.app.runtime.sync.outbox.SyncOutboxRepositoryAdapter
import org.robolectric.RobolectricTestRunner

/** Confirms the adapter is a faithful 1:1 wrapper over Agent-12's real SyncOutboxRepository -- no field is dropped or mistranslated crossing SyncOutboxPort's boundary. */
@RunWith(RobolectricTestRunner::class)
class SyncOutboxRepositoryAdapterTest {
    private lateinit var db: PcaLocalDatabase

    @Before
    fun setUp() {
        db = PersistenceTestSupport.inMemoryDb()
    }

    @After
    fun tearDown() {
        db.close()
    }

    @Test
    fun `enqueue and getReadyForDelivery round-trip through the port with all fields intact`() = runTest {
        val repository = org.pca.app.persistence.sync.SyncOutboxRepository(db.syncOutboxDao(), PersistenceTestSupport.testCipher())
        val adapter = SyncOutboxRepositoryAdapter(repository)

        val enqueued = adapter.enqueue("msg-1", "family-1", "recipient-1", "already-e2ee-ciphertext-b64", sequence = 7L, expiresAtEpochMillis = 999_999L, createdAtEpochMillis = 1000L)
        assertTrue(enqueued)

        val ready = adapter.getReadyForDelivery(nowEpochMillis = 2000L)
        assertEquals(1, ready.size)
        assertEquals("msg-1", ready[0].messageId)
        assertEquals("family-1", ready[0].familyScope)
        assertEquals("recipient-1", ready[0].recipientScope)
        assertEquals("already-e2ee-ciphertext-b64", ready[0].envelopeCiphertextBase64)
        assertEquals(7L, ready[0].sequence)
        assertEquals(999_999L, ready[0].expiresAtEpochMillis)
        assertEquals(0, ready[0].retryCount)
    }

    @Test
    fun `markFailedForRetry increments retryCount and is reflected back through the port`() = runTest {
        val repository = org.pca.app.persistence.sync.SyncOutboxRepository(db.syncOutboxDao(), PersistenceTestSupport.testCipher())
        val adapter = SyncOutboxRepositoryAdapter(repository)
        adapter.enqueue("msg-1", "family-1", "recipient-1", "ciphertext-b64", sequence = 1L, expiresAtEpochMillis = 999_999L, createdAtEpochMillis = 0L)

        adapter.markFailedForRetry("msg-1", nextRetryAtEpochMillis = 500L)

        val ready = adapter.getReadyForDelivery(nowEpochMillis = 500L)
        assertEquals(1, ready[0].retryCount)
    }

    @Test
    fun `markSent removes the item from getReadyForDelivery`() = runTest {
        val repository = org.pca.app.persistence.sync.SyncOutboxRepository(db.syncOutboxDao(), PersistenceTestSupport.testCipher())
        val adapter = SyncOutboxRepositoryAdapter(repository)
        adapter.enqueue("msg-1", "family-1", "recipient-1", "ciphertext-b64", sequence = 1L, expiresAtEpochMillis = 999_999L, createdAtEpochMillis = 0L)

        adapter.markSent("msg-1")

        assertEquals(0, adapter.getReadyForDelivery(nowEpochMillis = 2000L).size)
    }
}
