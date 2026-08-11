package org.pca.app.persistence

import androidx.room.withTransaction
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.pca.app.persistence.entity.SyncReceiptApplicationState
import org.pca.app.persistence.entity.SyncReceiptRecordEntity
import org.pca.app.persistence.entity.UsageSessionEntity
import org.pca.app.persistence.entity.SourceConfidence
import org.pca.app.persistence.sync.SyncReceiptRepository
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class ConcurrencyAndTransactionTest {
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
    fun `an exception mid-transaction rolls back every write in that transaction`() = runTest {
        db.deviceKeyMetadataDao().upsert(
            org.pca.app.persistence.entity.DeviceKeyMetadataEntity("key-existing", "device-1", org.pca.app.persistence.entity.DeviceKeyState.ACTIVE, 1L),
        )

        try {
            db.withTransaction {
                db.deviceKeyMetadataDao().upsert(
                    org.pca.app.persistence.entity.DeviceKeyMetadataEntity("key-new", "device-1", org.pca.app.persistence.entity.DeviceKeyState.ACTIVE, 2L),
                )
                throw IllegalStateException("simulated failure mid Delete Now / mid write")
            }
        } catch (expected: IllegalStateException) {
            // expected -- verifying the write inside the transaction did not survive it.
        }

        assertEquals(1, db.deviceKeyMetadataDao().getForDevice("device-1").size)
        assertEquals("key-existing", db.deviceKeyMetadataDao().getForDevice("device-1").single().publicKeyId)
    }

    @Test
    fun `concurrent inserts of usage sessions with distinct ids all persist without corruption`() = runTest {
        val dao = db.usageSessionDao()

        val jobs = (1..50).map { i ->
            async {
                dao.upsert(
                    UsageSessionEntity(
                        id = "session-$i",
                        deviceId = "device-1",
                        appOrCategoryTokenEnc = "enc",
                        appOrCategoryTokenIv = "iv",
                        startedAtEpochMillis = i.toLong(),
                        endedAtEpochMillis = i.toLong() + 100,
                        durationMillis = 100,
                        sourceConfidence = SourceConfidence.PLATFORM_API,
                    ),
                )
            }
        }
        jobs.awaitAll()

        assertEquals(50, dao.count())
    }

    @Test
    fun `concurrent duplicate-id inserts converge to one row via REPLACE, no corruption`() = runTest {
        val dao = db.usageSessionDao()

        val jobs = (1..20).map { i ->
            async {
                dao.upsert(
                    UsageSessionEntity(
                        id = "same-session",
                        deviceId = "device-1",
                        appOrCategoryTokenEnc = "enc-$i",
                        appOrCategoryTokenIv = "iv",
                        startedAtEpochMillis = i.toLong(),
                        endedAtEpochMillis = i.toLong() + 100,
                        durationMillis = 100,
                        sourceConfidence = SourceConfidence.PLATFORM_API,
                    ),
                )
            }
        }
        jobs.awaitAll()

        assertEquals(1, dao.count())
    }

    @Test
    fun `concurrent idempotent receipt inserts for the same messageId apply exactly once`() = runTest {
        val repo = SyncReceiptRepository(db.syncReceiptDao())

        val jobs = (1..20).map {
            async {
                repo.apply("same-message", "family-1", "device-2", sequence = 1L, keyEpoch = 1L, currentKeyEpoch = 1L, receivedAtEpochMillis = 1000L)
            }
        }
        jobs.awaitAll()

        assertEquals(1, db.syncReceiptDao().count())
        assertEquals(SyncReceiptApplicationState.APPLIED, db.syncReceiptDao().getById("same-message")!!.applicationState)
    }

    @Test
    fun `Delete Now interrupted before commit leaves prior state intact (rollback, not partial delete)`() = runTest {
        db.usageSessionDao().upsert(
            UsageSessionEntity("s1", "device-1", "enc", "iv", 1000L, 1100L, 100L, SourceConfidence.PLATFORM_API),
        )

        try {
            db.withTransaction {
                db.usageSessionDao().deleteAllForDevice("device-1")
                throw RuntimeException("simulated crash mid Delete Now")
            }
        } catch (expected: RuntimeException) {
            // expected
        }

        assertEquals(1, db.usageSessionDao().count())
    }
}
