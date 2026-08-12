package org.pca.app.runtime.location

import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.pca.app.persistence.PcaLocalDatabase
import org.pca.app.persistence.PersistenceTestSupport
import org.pca.app.persistence.entity.RetentionPolicy
import org.pca.app.persistence.repository.LocationPointRepository
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class LocationSyncPortTest {
    private lateinit var db: PcaLocalDatabase
    private lateinit var repository: LocationPointRepository

    @Before
    fun setUp() {
        db = PersistenceTestSupport.inMemoryDb()
        repository = LocationPointRepository(db.locationPointDao(), PersistenceTestSupport.testCipher())
    }

    @After
    fun tearDown() {
        db.close()
    }

    @Test
    fun `pending samples surface the real decrypted coordinates and correct precision tier for the sync layer to encrypt`() = runTest {
        repository.record(
            deviceId = "device-1",
            timestampEpochMillis = 1_000L,
            latitude = 24.71,
            longitude = 46.67,
            accuracyMeters = 1200f,
            source = LocationSampleRecorder.SOURCE_APPROXIMATE,
            retentionPolicy = RetentionPolicy.ONE_MONTH,
            id = "point-1",
        )
        repository.record(
            deviceId = "device-1",
            timestampEpochMillis = 2_000L,
            latitude = 24.7136,
            longitude = 46.6753,
            accuracyMeters = 5f,
            source = LocationSampleRecorder.SOURCE_PLATFORM_FIX,
            retentionPolicy = RetentionPolicy.ONE_MONTH,
            id = "point-2",
        )

        val port: LocationSyncPayloadSource = RepositoryBackedLocationSyncPayloadSource(repository)
        val payloads = port.pendingSamplesForSync("device-1").associateBy { it.sampleId }

        assertEquals(LocationPrecisionTier.APPROXIMATE, payloads.getValue("point-1").precisionTier)
        assertEquals(24.71, payloads.getValue("point-1").latitude, 1e-9)
        assertEquals(LocationPrecisionTier.EXACT, payloads.getValue("point-2").precisionTier)
        assertEquals(24.7136, payloads.getValue("point-2").latitude, 1e-9)
    }

    /**
     * Proof that no plaintext coordinate can leave this boundary through the most common
     * accidental leak path -- a log statement, string interpolation, or any other implicit
     * toString() call on the payload object itself. This does not prove the eventual network
     * transport is safe (that is the E2EE envelope layer's job, out of this lane's scope) -- it
     * proves THIS type cannot be casually stringified into plaintext coordinates.
     */
    @Test
    fun `toString never exposes the raw coordinates -- defense in depth against accidental logging`() = runTest {
        repository.record(
            deviceId = "device-1",
            timestampEpochMillis = 1_000L,
            latitude = 24.7136,
            longitude = 46.6753,
            accuracyMeters = 5f,
            source = LocationSampleRecorder.SOURCE_PLATFORM_FIX,
            retentionPolicy = RetentionPolicy.ONE_MONTH,
            id = "point-1",
        )

        val payload = RepositoryBackedLocationSyncPayloadSource(repository).pendingSamplesForSync("device-1").single()
        val rendered = payload.toString()

        assertFalse(rendered.contains("24.7136"))
        assertFalse(rendered.contains("46.6753"))
        assertEquals(true, rendered.contains("REDACTED"))
        // The non-sensitive fields must still be present -- redaction targets coordinates only.
        assertEquals(true, rendered.contains("point-1"))
    }
}
