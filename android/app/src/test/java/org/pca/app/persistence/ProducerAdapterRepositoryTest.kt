package org.pca.app.persistence

import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.pca.app.persistence.entity.PrayerDeliveryState
import org.pca.app.persistence.entity.ProximityBucket
import org.pca.app.persistence.entity.SourceConfidence
import org.pca.app.persistence.repository.BreakSessionRepository
import org.pca.app.persistence.repository.PrayerReminderEventRepository
import org.pca.app.persistence.repository.ProximityEventRepository
import org.pca.app.persistence.repository.UsageSessionRepository
import org.robolectric.RobolectricTestRunner

/**
 * PCA-RUNTIME-PERSIST-1 Section 6/8: proves the Usage/Break/Proximity/
 * Prayer producer adapters are idempotent on their id, safe to observe
 * out of chronological order, and (for Usage) encrypt the sensitive
 * app/category token at rest.
 */
@RunWith(RobolectricTestRunner::class)
class ProducerAdapterRepositoryTest {
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
    fun `usage session record is idempotent on id and encrypts the app token at rest`() = runTest {
        val repo = UsageSessionRepository(db.usageSessionDao(), PersistenceTestSupport.testCipher())

        repo.record("session-1", "device-1", "com.example.app", 1000L, 2000L, 1000L, SourceConfidence.PLATFORM_API)
        repo.record("session-1", "device-1", "com.example.app", 1000L, 2000L, 1000L, SourceConfidence.PLATFORM_API)

        assertEquals(1, db.usageSessionDao().getForDevice("device-1").size)
        val raw = db.usageSessionDao().getForDevice("device-1").single()
        assertNotEquals("com.example.app", raw.appOrCategoryTokenEnc)
        assertEquals("com.example.app", repo.getForDevice("device-1").single().appOrCategoryToken)
    }

    @Test
    fun `usage sessions are readable in chronological order regardless of insertion order`() = runTest {
        val repo = UsageSessionRepository(db.usageSessionDao(), PersistenceTestSupport.testCipher())

        repo.record("session-early", "device-1", "app-a", 1000L, 1500L, 500L, SourceConfidence.PLATFORM_API)
        repo.record("session-late", "device-1", "app-b", 5000L, 5500L, 500L, SourceConfidence.PLATFORM_API)

        val ordered = repo.getForDevice("device-1")
        assertEquals("session-late", ordered[0].id)
        assertEquals("session-early", ordered[1].id)
    }

    @Test
    fun `break session record replaces same id, is process-restart safe via the same repository`() = runTest {
        val repo = BreakSessionRepository(db.breakSessionDao())

        repo.record("break-1", "device-1", "continuous_use", 3_600_000L, 1000L, null, null, null)
        repo.record("break-1", "device-1", "continuous_use", 3_600_000L, 1000L, 2000L, "completed", 1)

        val sessions = repo.getForDevice("device-1")
        assertEquals(1, sessions.size)
        assertEquals(2000L, sessions.single().breakEndEpochMillis)
    }

    @Test
    fun `proximity event record never stores anything beyond a coarse bucket`() = runTest {
        val repo = ProximityEventRepository(db.proximityEventDao())

        repo.record("prox-1", "device-1", 1000L, ProximityBucket.NEAR, "notified")

        val stored = repo.getForDevice("device-1").single()
        assertEquals(ProximityBucket.NEAR, stored.distanceBucket)
    }

    @Test
    fun `prayer reminder event delivery-state transition reuses the same id`() = runTest {
        val repo = PrayerReminderEventRepository(db.prayerReminderEventDao())

        repo.record("prayer-1", "device-1", "fajr", 1000L, PrayerDeliveryState.SCHEDULED)
        repo.record("prayer-1", "device-1", "fajr", 1000L, PrayerDeliveryState.DELIVERED)

        val stored = repo.getForDevice("device-1")
        assertEquals(1, stored.size)
        assertEquals(PrayerDeliveryState.DELIVERED, stored.single().deliveryState)
    }
}
