package org.pca.app.persistence

import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.pca.app.persistence.entity.SyncOutboxState
import org.pca.app.persistence.sync.ReceiptOutcome
import org.pca.app.persistence.sync.SyncOutboxRepository
import org.pca.app.persistence.sync.SyncReceiptRepository
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class SyncOutboxAndReceiptTest {
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
    fun `re-enqueuing the same messageId is a no-op, not a duplicate row`() = runTest {
        val repo = SyncOutboxRepository(db.syncOutboxDao(), PersistenceTestSupport.testCipher())

        val first = repo.enqueue("msg-1", "family-1", "device-2", "ciphertext-b64", 1L, 999_999L, 1000L)
        val second = repo.enqueue("msg-1", "family-1", "device-2", "different-ciphertext-b64", 1L, 999_999L, 1000L)

        assertTrue(first)
        assertFalse(second)
        assertEquals(1, db.syncOutboxDao().count())
    }

    @Test
    fun `outbox envelope ciphertext is wrapped in local-at-rest encryption, not stored as-is`() = runTest {
        val repo = SyncOutboxRepository(db.syncOutboxDao(), PersistenceTestSupport.testCipher())
        val originalEnvelope = "already-e2ee-encrypted-envelope-bytes-as-base64"

        repo.enqueue("msg-1", "family-1", "device-2", originalEnvelope, 1L, 999_999L, 1000L)

        val rawRow = db.syncOutboxDao().getById("msg-1")!!
        assertNotEquals(originalEnvelope, rawRow.envelopeCipherEnc)

        val ready = repo.getReadyForDelivery(nowEpochMillis = 2000L)
        assertEquals(originalEnvelope, ready.single().second)
    }

    @Test
    fun `expired outbox entries are removed by deleteExpired`() = runTest {
        val repo = SyncOutboxRepository(db.syncOutboxDao(), PersistenceTestSupport.testCipher())
        repo.enqueue("msg-expired", "family-1", "device-2", "x", 1L, expiresAtEpochMillis = 500L, createdAtEpochMillis = 0L)
        repo.enqueue("msg-fresh", "family-1", "device-2", "x", 2L, expiresAtEpochMillis = 999_999L, createdAtEpochMillis = 0L)

        repo.deleteExpired(nowEpochMillis = 1000L)

        assertEquals(SyncOutboxState.PENDING, db.syncOutboxDao().getById("msg-fresh")!!.state)
        assertEquals(null, db.syncOutboxDao().getById("msg-expired"))
    }

    @Test
    fun `duplicate receipt delivery is rejected, applied is idempotent`() = runTest {
        val repo = SyncReceiptRepository(db.syncReceiptDao())

        val first = repo.apply("msg-1", "family-1", "device-2", sequence = 1L, keyEpoch = 1L, currentKeyEpoch = 1L, receivedAtEpochMillis = 1000L)
        val duplicate = repo.apply("msg-1", "family-1", "device-2", sequence = 1L, keyEpoch = 1L, currentKeyEpoch = 1L, receivedAtEpochMillis = 2000L)

        assertEquals(ReceiptOutcome.APPLIED, first)
        assertEquals(ReceiptOutcome.DUPLICATE_IGNORED, duplicate)
        assertEquals(1, db.syncReceiptDao().count())
    }

    @Test
    fun `out-of-order receipt is rejected`() = runTest {
        val repo = SyncReceiptRepository(db.syncReceiptDao())
        repo.apply("msg-2", "family-1", "device-2", sequence = 2L, keyEpoch = 1L, currentKeyEpoch = 1L, receivedAtEpochMillis = 1000L)

        val outOfOrder = repo.apply("msg-1", "family-1", "device-2", sequence = 1L, keyEpoch = 1L, currentKeyEpoch = 1L, receivedAtEpochMillis = 2000L)

        assertEquals(ReceiptOutcome.OUT_OF_ORDER_REJECTED, outOfOrder)
    }

    @Test
    fun `stale key epoch receipt is rejected`() = runTest {
        val repo = SyncReceiptRepository(db.syncReceiptDao())

        val stale = repo.apply("msg-1", "family-1", "device-2", sequence = 1L, keyEpoch = 1L, currentKeyEpoch = 3L, receivedAtEpochMillis = 1000L)

        assertEquals(ReceiptOutcome.STALE_EPOCH_REJECTED, stale)
    }
}
