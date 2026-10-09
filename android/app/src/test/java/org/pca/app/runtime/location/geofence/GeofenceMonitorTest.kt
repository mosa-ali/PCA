package org.pca.app.runtime.location.geofence

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.pca.app.foundation.InMemoryPersistentStateStore
import org.pca.app.platform.LocationSample

class GeofenceMonitorTest {

    private val storage = InMemoryPersistentStateStore()
    private val familyA = GeofenceStorageScope("family-a", "device-a")
    private var activeScope: GeofenceStorageScope? = familyA
    private val scopeProvider = { activeScope }
    private val zoneStore = GeofenceZoneStore(storage, scopeProvider = scopeProvider)
    private val zoneStateStore = GeofenceZoneStateStore(storage, scopeProvider = scopeProvider)
    private val alertPort = RecordingGeofenceAlertPort()
    private val config = GeofenceConfig(hysteresisMeters = 0.0, requiredConsecutiveSamplesToConfirm = 1)
    private lateinit var monitor: GeofenceMonitor

    private val homeZone = GeofenceZone("home", "Home", 25.0, 55.0, 100.0)

    @Before
    fun setUp() {
        monitor = GeofenceMonitor(zoneStore, zoneStateStore, alertPort, config)
    }

    private fun sampleAtDistance(zone: GeofenceZone, meters: Double): LocationSample {
        val deltaLatDegrees = Math.toDegrees(meters / 6_371_000.0)
        return LocationSample(
            latitude = zone.centerLatitude + deltaLatDegrees,
            longitude = zone.centerLongitude,
            accuracyMeters = 5f,
            elapsedRealtimeMillis = 0L,
        )
    }

    @Test
    fun `no zones configured yields no events and never touches the alert port`() {
        val events = monitor.evaluateSample(sampleAtDistance(homeZone, 10.0), 1L)
        assertTrue(events.isEmpty())
        assertTrue(alertPort.delivered.isEmpty())
    }

    @Test
    fun `cold-start baseline produces no alert`() {
        zoneStore.addOrReplace(homeZone)
        val events = monitor.evaluateSample(sampleAtDistance(homeZone, 10.0), 1L)
        assertTrue(events.isEmpty())
        assertTrue(alertPort.delivered.isEmpty())
    }

    @Test
    fun `a genuine exit after baseline is confirmed produces exactly one alert`() {
        zoneStore.addOrReplace(homeZone)
        monitor.evaluateSample(sampleAtDistance(homeZone, 10.0), 1L) // baseline: INSIDE

        val events = monitor.evaluateSample(sampleAtDistance(homeZone, 500.0), 2L)
        assertEquals(1, events.size)
        assertEquals(GeofenceTransitionType.EXIT, events.first().transitionType)
        assertEquals(1, alertPort.delivered.size)
        assertEquals("home", alertPort.delivered.first().zoneId)
    }

    @Test
    fun `zone state persists across separate monitor instances`() {
        zoneStore.addOrReplace(homeZone)
        monitor.evaluateSample(sampleAtDistance(homeZone, 10.0), 1L) // baseline: INSIDE

        val secondMonitor = GeofenceMonitor(zoneStore, zoneStateStore, alertPort, config)
        val events = secondMonitor.evaluateSample(sampleAtDistance(homeZone, 500.0), 2L)
        assertEquals(1, events.size)
        assertEquals(GeofenceTransitionType.EXIT, events.first().transitionType)
    }

    @Test
    fun `multiple zones are evaluated independently in one sample`() {
        val schoolZone = GeofenceZone("school", "School", 25.01, 55.0, 50.0)
        zoneStore.addOrReplace(homeZone)
        zoneStore.addOrReplace(schoolZone)

        // Establish both zones' baseline as already-confirmed OUTSIDE (bypassing the cold-start
        // no-alert rule so this test isolates the "independent per-zone verdict" behavior).
        zoneStateStore.save(GeofenceZoneState(zoneId = "school", confirmedMembership = GeofenceMembership.OUTSIDE))
        zoneStateStore.save(GeofenceZoneState(zoneId = "home", confirmedMembership = GeofenceMembership.OUTSIDE))

        // A sample near home is INSIDE home's radius but necessarily still far outside school's
        // (school's center is ~1.1km away) -- only home should confirm an ENTRY.
        val events = monitor.evaluateSample(sampleAtDistance(homeZone, 10.0), 3L)
        assertEquals(1, events.size)
        assertEquals("home", events.first().zoneId)
        assertEquals(GeofenceTransitionType.ENTRY, events.first().transitionType)
    }

    @Test
    fun `family switch after zone snapshot prevents mixed-scope state and alerts`() {
        zoneStore.addOrReplace(homeZone)
        var scopeReads = 0
        val switchingProvider = {
            scopeReads += 1
            if (scopeReads == 1) familyA else GeofenceStorageScope("family-b", "device-b")
        }
        val switchingStore = GeofenceZoneStore(storage, scopeProvider = switchingProvider)
        val switchingStateStore = GeofenceZoneStateStore(storage, scopeProvider = switchingProvider)
        val switchingMonitor = GeofenceMonitor(switchingStore, switchingStateStore, alertPort, config)

        val events = switchingMonitor.evaluateSample(sampleAtDistance(homeZone, 10.0), 9L)

        assertTrue(events.isEmpty())
        assertTrue(alertPort.delivered.isEmpty())
        assertNull(switchingStateStore.load(GeofenceStorageScope("family-a", "device-a"), homeZone.zoneId))
    }

    @Test
    fun `corrupt duplicate zone snapshot cannot advance debounce twice or emit an alert`() {
        val key = familyA.zoneStoreKey("geofence_zones_v2")
        val duplicate = listOf(
            "home|Home A|25.0|55.0|100.0|true|ENTRY,EXIT|1",
            "home|Home B|25.0|55.0|100.0|true|ENTRY,EXIT|2",
        ).joinToString("\n")
        storage.putString(key, duplicate)
        val prior = GeofenceZoneState(zoneId = "home", confirmedMembership = GeofenceMembership.OUTSIDE)
        zoneStateStore.save(prior)

        val events = monitor.evaluateSample(sampleAtDistance(homeZone, 10.0), nowMonotonicNanos = 0L)

        assertTrue(events.isEmpty())
        assertTrue(alertPort.delivered.isEmpty())
        assertEquals(prior, zoneStateStore.load("home"))
    }
}
