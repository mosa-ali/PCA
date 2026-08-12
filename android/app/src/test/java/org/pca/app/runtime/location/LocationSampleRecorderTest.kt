package org.pca.app.runtime.location

import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.pca.app.persistence.PcaLocalDatabase
import org.pca.app.persistence.PersistenceTestSupport
import org.pca.app.persistence.entity.RetentionPolicy
import org.pca.app.persistence.repository.LocationPointRepository
import org.pca.app.persistence.retention.RetentionCutoffCalculator
import org.pca.app.platform.BackgroundLocationState
import org.pca.app.platform.LocationCapabilitySnapshot
import org.pca.app.platform.LocationPermissionState
import org.pca.app.platform.LocationProviderAvailability
import org.pca.app.platform.LocationCapabilitySource
import org.pca.app.platform.LocationSample
import org.pca.app.platform.LocationServicesState
import org.pca.app.runtime.FakeMonotonicTimeSource
import org.pca.app.runtime.FakeWallClockTimeSource
import org.robolectric.RobolectricTestRunner
import java.time.Instant
import java.time.ZoneOffset

/** Local fake, deliberately not the shared `org.pca.app.runtime.FakeLocationCapabilitySource`
 * (its [LocationCapabilitySource.lastKnownLocation] is hardcoded to null) -- this suite needs a
 * settable last-known fix to exercise [LocationSampleRecorder]'s capture path. */
private class ConfigurableFakeLocationCapabilitySource(
    var snapshot: LocationCapabilitySnapshot,
    var lastSample: LocationSample?,
) : LocationCapabilitySource {
    override fun currentCapability(): LocationCapabilitySnapshot = snapshot
    override fun lastKnownLocation(): LocationSample? = lastSample

    companion object {
        fun unusableSnapshot() = LocationCapabilitySnapshot(
            permissionState = LocationPermissionState.DENIED,
            backgroundState = BackgroundLocationState.NOT_APPLICABLE_FOREGROUND_DENIED,
            servicesState = LocationServicesState.DISABLED,
            providerAvailability = LocationProviderAvailability(gpsProviderEnabled = false, networkProviderEnabled = false),
            backgroundExecutionUnrestricted = false,
        )
    }
}

@RunWith(RobolectricTestRunner::class)
class LocationSampleRecorderTest {
    private lateinit var db: PcaLocalDatabase
    private lateinit var repository: LocationPointRepository
    private val capabilitySource = ConfigurableFakeLocationCapabilitySource(
        snapshot = ConfigurableFakeLocationCapabilitySource.unusableSnapshot(),
        lastSample = null,
    )
    private val monotonic = FakeMonotonicTimeSource(0L)
    private val wallClock = FakeWallClockTimeSource(1_700_000_000_000L)

    @Before
    fun setUp() {
        db = PersistenceTestSupport.inMemoryDb()
        repository = LocationPointRepository(db.locationPointDao(), PersistenceTestSupport.testCipher())
    }

    @After
    fun tearDown() {
        db.close()
    }

    private fun recorder() = LocationSampleRecorder(capabilitySource, repository, monotonic, wallClock)

    private fun fineSnapshot() = LocationCapabilitySnapshot(
        permissionState = LocationPermissionState.FINE,
        backgroundState = BackgroundLocationState.GRANTED,
        servicesState = LocationServicesState.ENABLED,
        providerAvailability = LocationProviderAvailability(gpsProviderEnabled = true, networkProviderEnabled = true),
        backgroundExecutionUnrestricted = true,
    )

    // -- fine permission -------------------------------------------------------------------------

    @Test
    fun `fine permission with a real fix is recorded as AVAILABLE with exact coordinates preserved`() = runTest {
        capabilitySource.snapshot = fineSnapshot()
        capabilitySource.lastSample = LocationSample(24.7136, 46.6753, 5.0f, elapsedRealtimeMillis = 0L)

        val result = recorder().captureSample("device-1", RetentionPolicy.ONE_MONTH)

        assertEquals(LocationSampleStatus.AVAILABLE, result.status)
        assertTrue(result.recorded)
        val point = repository.getForDevice("device-1").single()
        assertEquals(24.7136, point.latitude, 0.0000001)
        assertEquals(46.6753, point.longitude, 0.0000001)
        assertEquals(5.0f, point.accuracyMeters)
    }

    // -- coarse-only permission --------------------------------------------------------------------

    @Test
    fun `coarse-only permission is recorded as APPROXIMATE_ONLY with grid-rounded coordinates, never the exact fix`() = runTest {
        capabilitySource.snapshot = fineSnapshot().copy(
            permissionState = LocationPermissionState.COARSE_ONLY,
            backgroundState = BackgroundLocationState.NOT_APPLICABLE_FOREGROUND_DENIED,
        )
        capabilitySource.lastSample = LocationSample(24.71361234, 46.67539876, 5.0f, elapsedRealtimeMillis = 0L)

        val result = recorder().captureSample("device-1", RetentionPolicy.ONE_MONTH)

        assertEquals(LocationSampleStatus.APPROXIMATE_ONLY, result.status)
        assertTrue(result.recorded)
        val point = repository.getForDevice("device-1").single()
        // Grid-rounded to the 0.01-degree floor -- never the precise fix the platform reported.
        assertEquals(24.71, point.latitude, 1e-9)
        assertEquals(46.67, point.longitude, 1e-9)
        assertTrue("accuracy must be widened to at least the approximate floor", point.accuracyMeters >= 1000f)
        assertEquals(LocationSampleRecorder.SOURCE_APPROXIMATE, point.source)
    }

    // -- permission denied ------------------------------------------------------------------------

    @Test
    fun `permission denied -- nothing is captured or persisted, status is honest`() = runTest {
        capabilitySource.snapshot = ConfigurableFakeLocationCapabilitySource.unusableSnapshot()
            .copy(servicesState = LocationServicesState.ENABLED, providerAvailability = LocationProviderAvailability(true, true))
        capabilitySource.lastSample = LocationSample(24.0, 46.0, 5.0f, 0L) // even if a fix WERE available, permission blocks it

        val result = recorder().captureSample("device-1", RetentionPolicy.ONE_MONTH)

        assertEquals(LocationSampleStatus.PERMISSION_REQUIRED, result.status)
        assertFalse(result.recorded)
        assertTrue(repository.getForDevice("device-1").isEmpty())
    }

    // -- provider / services disabled ---------------------------------------------------------------

    @Test
    fun `location services disabled system-wide -- nothing is captured even with fine permission`() = runTest {
        capabilitySource.snapshot = fineSnapshot().copy(servicesState = LocationServicesState.DISABLED)
        capabilitySource.lastSample = LocationSample(24.0, 46.0, 5.0f, 0L)

        val result = recorder().captureSample("device-1", RetentionPolicy.ONE_MONTH)

        assertEquals(LocationSampleStatus.LOCATION_DISABLED, result.status)
        assertFalse(result.recorded)
        assertTrue(repository.getForDevice("device-1").isEmpty())
    }

    @Test
    fun `no provider enabled -- nothing is captured, status is UNAVAILABLE`() = runTest {
        capabilitySource.snapshot = fineSnapshot().copy(
            providerAvailability = LocationProviderAvailability(gpsProviderEnabled = false, networkProviderEnabled = false),
        )
        capabilitySource.lastSample = LocationSample(24.0, 46.0, 5.0f, 0L)

        val result = recorder().captureSample("device-1", RetentionPolicy.ONE_MONTH)

        assertEquals(LocationSampleStatus.UNAVAILABLE, result.status)
        assertFalse(result.recorded)
    }

    @Test
    fun `permission and services usable but the platform has no last-known fix -- never fabricated`() = runTest {
        capabilitySource.snapshot = fineSnapshot()
        capabilitySource.lastSample = null

        val result = recorder().captureSample("device-1", RetentionPolicy.ONE_MONTH)

        assertEquals(LocationSampleStatus.UNAVAILABLE, result.status)
        assertFalse(result.recorded)
        assertTrue(repository.getForDevice("device-1").isEmpty())
    }

    // -- offline persistence -----------------------------------------------------------------------

    @Test
    fun `capture works with zero network dependency`() = runTest {
        capabilitySource.snapshot = fineSnapshot()
        capabilitySource.lastSample = LocationSample(24.0, 46.0, 5.0f, 0L)

        val result = recorder().captureSample("device-1", RetentionPolicy.ONE_MONTH)
        assertTrue(result.recorded)
    }

    // -- encrypted-persistence seam ------------------------------------------------------------------

    @Test
    fun `the recorded point is never stored in plaintext -- the raw DB row round-trips only through the cipher`() = runTest {
        capabilitySource.snapshot = fineSnapshot()
        capabilitySource.lastSample = LocationSample(24.7136, 46.6753, 5.0f, 0L)

        recorder().captureSample("device-1", RetentionPolicy.ONE_MONTH)

        val rawRow = db.locationPointDao().getForDevice("device-1").single()
        assertFalse(rawRow.latitudeEnc.contains("24.7136"))
        assertFalse(rawRow.longitudeEnc.contains("46.6753"))
    }

    // -- retention enforcement ---------------------------------------------------------------------

    @Test
    fun `a recorded point falls out of retention once the policy cutoff passes it -- bounded, not kept forever`() = runTest {
        capabilitySource.snapshot = fineSnapshot()
        capabilitySource.lastSample = LocationSample(24.0, 46.0, 5.0f, elapsedRealtimeMillis = 0L)
        wallClock.nowMillis = Instant.parse("2026-01-01T00:00:00Z").toEpochMilli()

        recorder().captureSample("device-1", RetentionPolicy.FOURTEEN_DAYS)
        assertEquals(1, repository.getForDevice("device-1").size)

        val cutoff = RetentionCutoffCalculator.cutoffFor(
            RetentionPolicy.FOURTEEN_DAYS,
            Instant.parse("2026-01-20T00:00:00Z"),
            ZoneOffset.UTC,
        )
        val deleted = db.locationPointDao().deleteOlderThanForDevice("device-1", cutoff.toEpochMilli())

        assertEquals(1, deleted)
        assertTrue(repository.getForDevice("device-1").isEmpty())
    }

    @Test
    fun `LATEST_ONLY retention policy is enforced end to end through the recorder`() = runTest {
        capabilitySource.snapshot = fineSnapshot()

        capabilitySource.lastSample = LocationSample(1.0, 1.0, 5.0f, 0L)
        recorder().captureSample("device-1", RetentionPolicy.LATEST_ONLY)

        wallClock.nowMillis += 1_000L
        capabilitySource.lastSample = LocationSample(2.0, 2.0, 5.0f, 0L)
        recorder().captureSample("device-1", RetentionPolicy.LATEST_ONLY)

        val remaining = repository.getForDevice("device-1")
        assertEquals(1, remaining.size)
        assertEquals(2.0, remaining.single().latitude, 1e-9)
    }
}
