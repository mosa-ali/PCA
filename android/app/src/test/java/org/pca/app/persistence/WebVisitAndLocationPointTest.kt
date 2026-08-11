package org.pca.app.persistence

import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.pca.app.persistence.entity.RetentionPolicy
import org.pca.app.persistence.entity.WebVisitAction
import org.pca.app.persistence.repository.LocationPointRepository
import org.pca.app.persistence.repository.WebVisitRepository
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class WebVisitAndLocationPointTest {
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
    fun `web visit domain and url are encrypted at rest and round trip via the repository`() = runTest {
        val repo = WebVisitRepository(db.webVisitDao(), PersistenceTestSupport.testCipher())

        repo.record(
            deviceId = "device-1",
            domain = "example.com",
            url = "https://example.com/secret-path",
            title = "Secret Page",
            classificationCategory = "education",
            ruleOrModelVersion = "v1",
            action = WebVisitAction.ALLOWED,
            timestampEpochMillis = 1000L,
            id = "visit-1",
        )

        val rawRow = db.webVisitDao().getForDevice("device-1").single()
        assertNotEquals("example.com", rawRow.domainEnc)
        assertNotEquals("https://example.com/secret-path", rawRow.urlEnc)

        val visit = repo.getForDevice("device-1").single()
        assertEquals("example.com", visit.domain)
        assertEquals("https://example.com/secret-path", visit.url)
        assertEquals("Secret Page", visit.title)
    }

    @Test
    fun `optional url and title stay null through the encryption boundary when absent`() = runTest {
        val repo = WebVisitRepository(db.webVisitDao(), PersistenceTestSupport.testCipher())

        repo.record(
            deviceId = "device-1",
            domain = "no-url-mode.example",
            url = null,
            title = null,
            classificationCategory = "unknown",
            ruleOrModelVersion = "v1",
            action = WebVisitAction.BLOCKED,
            timestampEpochMillis = 1000L,
        )

        val visit = repo.getForDevice("device-1").single()
        assertEquals(null, visit.url)
        assertEquals(null, visit.title)
    }

    @Test
    fun `location latitude and longitude are never stored in plaintext`() = runTest {
        val repo = LocationPointRepository(db.locationPointDao(), PersistenceTestSupport.testCipher())

        repo.record(
            deviceId = "device-1",
            timestampEpochMillis = 1000L,
            latitude = 24.7136,
            longitude = 46.6753,
            accuracyMeters = 5.0f,
            source = "GPS",
            retentionPolicy = RetentionPolicy.ONE_MONTH,
        )

        val rawRow = db.locationPointDao().getForDevice("device-1").single()
        assertFalse(rawRow.latitudeEnc.contains("24.7136"))
        assertFalse(rawRow.longitudeEnc.contains("46.6753"))

        val point = repo.getForDevice("device-1").single()
        assertEquals(24.7136, point.latitude, 0.0001)
        assertEquals(46.6753, point.longitude, 0.0001)
    }

    @Test
    fun `LATEST_ONLY retention keeps exactly one location point per device`() = runTest {
        val repo = LocationPointRepository(db.locationPointDao(), PersistenceTestSupport.testCipher())

        repo.record("device-1", 1000L, 1.0, 1.0, 5f, "GPS", RetentionPolicy.LATEST_ONLY, id = "p1")
        repo.record("device-1", 2000L, 2.0, 2.0, 5f, "GPS", RetentionPolicy.LATEST_ONLY, id = "p2")
        repo.record("device-1", 3000L, 3.0, 3.0, 5f, "GPS", RetentionPolicy.LATEST_ONLY, id = "p3")

        val remaining = repo.getForDevice("device-1")
        assertEquals(1, remaining.size)
        assertEquals(3000L, remaining.single().timestampEpochMillis)
    }
}
