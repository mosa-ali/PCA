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
import org.pca.app.persistence.crypto.LocalRecordCipher
import org.pca.app.persistence.dao.LocationPointDao
import org.pca.app.persistence.entity.LocationPointEntity
import org.pca.app.persistence.entity.RetentionPolicy
import org.pca.app.persistence.repository.LocationPointRepository
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class LocationSyncPortTest {
    private lateinit var db: PcaLocalDatabase
    private lateinit var repository: LocationPointRepository
    private lateinit var cipher: LocalRecordCipher

    @Before
    fun setUp() {
        db = PersistenceTestSupport.inMemoryDb()
        cipher = PersistenceTestSupport.testCipher()
        repository = LocationPointRepository(db.locationPointDao(), cipher)
    }

    @After
    fun tearDown() {
        db.close()
    }

    @Test
    fun `available samples are currently stored device-scoped rows with repeatable reads and correct precision`() = runTest {
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
        repository.record(
            deviceId = "device-2",
            timestampEpochMillis = 3_000L,
            latitude = 35.0,
            longitude = 45.0,
            accuracyMeters = 800f,
            source = LocationSampleRecorder.SOURCE_APPROXIMATE,
            retentionPolicy = RetentionPolicy.ONE_MONTH,
            id = "point-3",
        )

        val port: LocationSyncPayloadSource = RepositoryBackedLocationSyncPayloadSource(repository)
        val firstRead = port.availableSamplesForSync("device-1")
        val secondRead = port.availableSamplesForSync("device-1")
        val payloads = firstRead.associateBy { it.sampleId }

        assertEquals(firstRead, secondRead)
        assertEquals(setOf("point-1", "point-2"), payloads.keys)
        assertEquals(setOf("device-1"), firstRead.map { it.deviceId }.toSet())
        assertEquals("point-3", port.availableSamplesForSync("device-2").single().sampleId)
        assertEquals(LocationPrecisionTier.APPROXIMATE, payloads.getValue("point-1").precisionTier)
        assertEquals("device-1", payloads.getValue("point-1").deviceId)
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

        val payload = RepositoryBackedLocationSyncPayloadSource(repository).availableSamplesForSync("device-1").single()
        val rendered = payload.toString()

        assertFalse(rendered.contains("24.7136"))
        assertFalse(rendered.contains("46.6753"))
        assertEquals(true, rendered.contains("REDACTED"))
        // The non-sensitive fields must still be present -- redaction targets coordinates only.
        assertEquals(true, rendered.contains("point-1"))
    }

    @Test
    fun `repository row outside requested device scope fails before coordinate decryption`() = runTest {
        repository.record(
            deviceId = "device-2",
            timestampEpochMillis = 1_000L,
            latitude = 24.7136,
            longitude = 46.6753,
            accuracyMeters = 5f,
            source = LocationSampleRecorder.SOURCE_PLATFORM_FIX,
            retentionPolicy = RetentionPolicy.ONE_MONTH,
            id = "point-2",
        )

        val delegate = db.locationPointDao()
        val misScopedDao = object : LocationPointDao by delegate {
            override suspend fun getForDevice(deviceId: String): List<LocationPointEntity> =
                if (deviceId == "device-1") delegate.getForDevice("device-2")
                else delegate.getForDevice(deviceId)
        }
        val port = RepositoryBackedLocationSyncPayloadSource(
            LocationPointRepository(misScopedDao, cipher),
        )

        var failure: IllegalStateException? = null
        try {
            port.availableSamplesForSync("device-1")
        } catch (caught: IllegalStateException) {
            failure = caught
        }
        assertEquals(
            "Location point DAO returned a row outside the requested device scope",
            failure?.message,
        )
    }

    @Test
    fun `unknown source fails closed instead of claiming exact precision`() = runTest {
        repository.record(
            deviceId = "device-1",
            timestampEpochMillis = 1_000L,
            latitude = 24.7136,
            longitude = 46.6753,
            accuracyMeters = 5f,
            source = "UNRECOGNIZED_SOURCE",
            retentionPolicy = RetentionPolicy.ONE_MONTH,
            id = "point-unknown",
        )

        var failure: IllegalStateException? = null
        try {
            RepositoryBackedLocationSyncPayloadSource(repository).availableSamplesForSync("device-1")
        } catch (caught: IllegalStateException) {
            failure = caught
        }
        assertEquals(
            "Location point has an unsupported source for sync precision",
            failure?.message,
        )
    }
}
