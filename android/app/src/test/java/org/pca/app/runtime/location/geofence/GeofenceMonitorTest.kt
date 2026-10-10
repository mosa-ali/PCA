package org.pca.app.runtime.location.geofence

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.pca.app.foundation.InMemoryPersistentStateStore
import org.pca.app.foundation.PersistentStateStore
import org.pca.app.platform.LocationSample
import java.io.IOException

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
        monitor = GeofenceMonitor(zoneStore, zoneStateStore, alertPort, config) { "boot-test" }
    }

    private fun sampleAtDistance(zone: GeofenceZone, meters: Double, elapsedRealtimeMillis: Long = 0L): LocationSample {
        val deltaLatDegrees = Math.toDegrees(meters / 6_371_000.0)
        return LocationSample(
            latitude = zone.centerLatitude + deltaLatDegrees,
            longitude = zone.centerLongitude,
            accuracyMeters = 5f,
            elapsedRealtimeMillis = elapsedRealtimeMillis,
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

        val secondMonitor = GeofenceMonitor(zoneStore, zoneStateStore, alertPort, config) { "boot-test" }
        val events = secondMonitor.evaluateSample(sampleAtDistance(homeZone, 500.0), 2L)
        assertEquals(1, events.size)
        assertEquals(GeofenceTransitionType.EXIT, events.first().transitionType)
    }

    @Test
    fun `device reboot reanchors monotonic state while preserving confirmed membership`() {
        zoneStore.addOrReplace(homeZone)
        val firstBoot = GeofenceMonitor(zoneStore, zoneStateStore, alertPort, config) { "boot-10" }
        firstBoot.evaluateSample(sampleAtDistance(homeZone, 10.0, elapsedRealtimeMillis = 10_000L), 10_000_000_000L)
        assertEquals("boot-10", zoneStateStore.load("home")?.bootInstanceId)
        assertEquals(GeofenceMembership.INSIDE, zoneStateStore.load("home")?.confirmedMembership)

        val afterReboot = GeofenceMonitor(zoneStore, zoneStateStore, alertPort, config) { "boot-11" }
        val events = afterReboot.evaluateSample(
            sampleAtDistance(homeZone, 500.0, elapsedRealtimeMillis = 2_000L),
            2_000_000_000L,
        )

        assertEquals(1, events.size)
        assertEquals(GeofenceTransitionType.EXIT, events.single().transitionType)
        assertEquals("boot-11", zoneStateStore.load("home")?.bootInstanceId)
        assertEquals(GeofenceMembership.OUTSIDE, zoneStateStore.load("home")?.confirmedMembership)
    }

    @Test
    fun `unknown boot identity skips geofence evaluation without rewriting persisted state`() {
        zoneStore.addOrReplace(homeZone)
        val persisted = GeofenceZoneState(
            zoneId = "home", confirmedMembership = GeofenceMembership.INSIDE,
            candidateMembership = GeofenceMembership.OUTSIDE, candidateStreak = 1,
            lastEvaluatedMonotonicNanos = 90_000_000_000L,
            lastAcceptedSampleElapsedRealtimeMillis = 90_000L,
            bootInstanceId = "boot-10",
        )
        zoneStateStore.save(persisted)
        val unknownBoot = GeofenceMonitor(zoneStore, zoneStateStore, alertPort, config)

        assertTrue(unknownBoot.evaluateSample(sampleAtDistance(homeZone, 500.0, 2_000L), 2_000_000_000L).isEmpty())
        assertEquals(persisted, zoneStateStore.load("home"))
        assertTrue(alertPort.delivered.isEmpty())
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
        val switchingMonitor = GeofenceMonitor(switchingStore, switchingStateStore, alertPort, config) { "boot-test" }

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

    @Test
    fun `corrupt state for any zone prevents partial sample enforcement`() {
        val schoolZone = GeofenceZone("school", "School", 25.01, 55.0, 50.0)
        zoneStore.addOrReplace(homeZone)
        zoneStore.addOrReplace(schoolZone)
        val homePrior = GeofenceZoneState(zoneId = "home", confirmedMembership = GeofenceMembership.OUTSIDE)
        zoneStateStore.save(homePrior)
        val corruptKey = familyA.zoneStateStoreKey("geofence_zone_state_v2", "school")
        storage.putString(corruptKey, "malformed")

        val events = monitor.evaluateSample(sampleAtDistance(homeZone, 10.0), nowMonotonicNanos = 0L)

        assertTrue(events.isEmpty())
        assertTrue(alertPort.delivered.isEmpty())
        assertEquals(homePrior, zoneStateStore.load("home"))
        assertEquals("malformed", storage.getString(corruptKey))
    }

    @Test
    fun `uncertain persistence read prevents sample enforcement without rewriting state`() {
        zoneStore.addOrReplace(homeZone)
        val prior = GeofenceZoneState(zoneId = "home", confirmedMembership = GeofenceMembership.OUTSIDE)
        zoneStateStore.save(prior)
        val stateKey = familyA.zoneStateStoreKey("geofence_zone_state_v2", "home")
        val failingRead = object : PersistentStateStore by storage {
            override val coordinationLock: Any get() = storage.coordinationLock
            override fun getString(key: String): String? {
                if (key == stateKey) throw IOException("simulated unavailable read")
                return storage.getString(key)
            }
        }
        val monitorWithUnavailableState = GeofenceMonitor(
            GeofenceZoneStore(failingRead, scopeProvider = scopeProvider),
            GeofenceZoneStateStore(failingRead, scopeProvider = scopeProvider),
            alertPort,
            config,
        ) { "boot-test" }

        val events = monitorWithUnavailableState.evaluateSample(sampleAtDistance(homeZone, 10.0), nowMonotonicNanos = 0L)

        assertTrue(events.isEmpty())
        assertTrue(alertPort.delivered.isEmpty())
        assertEquals(prior, zoneStateStore.load("home"))
    }
}
