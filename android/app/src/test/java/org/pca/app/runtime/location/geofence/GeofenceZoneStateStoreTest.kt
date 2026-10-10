package org.pca.app.runtime.location.geofence

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Test
import java.io.IOException
import org.pca.app.foundation.InMemoryPersistentStateStore
import org.pca.app.foundation.PersistentStateStore

class GeofenceZoneStateStoreTest {

    private val backing = InMemoryPersistentStateStore()
    private val familyA = GeofenceStorageScope("family-a", "device-a")
    private val familyB = GeofenceStorageScope("family-b", "device-b")
    private var activeScope: GeofenceStorageScope? = familyA
    private val store = GeofenceZoneStateStore(backing, scopeProvider = { activeScope })

    @Test
    fun `unknown zone returns null, never a fabricated default`() {
        assertNull(store.load("zone-1"))
    }

    @Test
    fun `round-trips a saved state exactly`() {
        val state = GeofenceZoneState(
            zoneId = "zone-1",
            confirmedMembership = GeofenceMembership.INSIDE,
            candidateMembership = GeofenceMembership.OUTSIDE,
            candidateStreak = 2,
            lastEvaluatedMonotonicNanos = 123_456_789L,
            lastAcceptedSampleElapsedRealtimeMillis = 987_654L,
            bootInstanceId = "boot-42",
        )
        store.save(state)
        assertEquals(state, store.load("zone-1"))
    }

    @Test
    fun `states for different zones do not interfere`() {
        store.save(GeofenceZoneState(zoneId = "zone-1", confirmedMembership = GeofenceMembership.INSIDE))
        store.save(GeofenceZoneState(zoneId = "zone-2", confirmedMembership = GeofenceMembership.OUTSIDE))

        assertEquals(GeofenceMembership.INSIDE, store.load("zone-1")?.confirmedMembership)
        assertEquals(GeofenceMembership.OUTSIDE, store.load("zone-2")?.confirmedMembership)
    }

    @Test
    fun `clear removes only the targeted zone state`() {
        store.save(GeofenceZoneState(zoneId = "zone-1", confirmedMembership = GeofenceMembership.INSIDE))
        store.save(GeofenceZoneState(zoneId = "zone-2", confirmedMembership = GeofenceMembership.OUTSIDE))
        store.clear("zone-1")

        assertNull(store.load("zone-1"))
        assertEquals(GeofenceMembership.OUTSIDE, store.load("zone-2")?.confirmedMembership)
    }

    @Test
    fun `corrupt raw value is distinct from absence and remains available for recovery`() {
        val key = familyA.zoneStateStoreKey("geofence_zone_state_v2", "zone-1")
        val raw = "garbage"
        backing.putString(key, raw)

        assertThrows(CorruptGeofenceZoneStateException::class.java) { store.load("zone-1") }
        assertEquals(raw, backing.getString(key))
    }

    @Test
    fun `malformed parseable debounce state is never trusted after restart`() {
        val key = familyA.zoneStateStoreKey("geofence_zone_state_v2", "zone-1")
        for (raw in listOf("INSIDE|OUTSIDE|-1|1|1", "INSIDE|OUTSIDE|1|-1|1",
            "INSIDE|OUTSIDE|1|1|-1", "INSIDE|INSIDE|1|1|1", "INSIDE|UNKNOWN|1|1|1")) {
            backing.putString(key, raw)
            assertThrows(CorruptGeofenceZoneStateException::class.java) { store.load("zone-1") }
            assertEquals(raw, backing.getString(key))
        }
    }

    @Test
    fun `save refuses to replace malformed persisted state`() {
        val key = familyA.zoneStateStoreKey("geofence_zone_state_v2", "zone-1")
        val raw = "INSIDE|OUTSIDE|-1|1|1"
        backing.putString(key, raw)

        assertThrows(CorruptGeofenceZoneStateException::class.java) {
            store.save(GeofenceZoneState(zoneId = "zone-1", confirmedMembership = GeofenceMembership.OUTSIDE))
        }
        assertEquals(raw, backing.getString(key))
    }

    @Test
    fun `read errors remain durability failures and do not write or erase state`() {
        val key = familyA.zoneStateStoreKey("geofence_zone_state_v2", "zone-1")
        val raw = "INSIDE|INSIDE|0|123456789|987654"
        backing.putString(key, raw)
        var mutations = 0
        val failingRead = object : PersistentStateStore by backing {
            override val coordinationLock: Any get() = backing.coordinationLock

            override fun getString(storageKey: String): String? {
                if (storageKey == key) {
                    throw IOException("simulated read failure")
                }
                return backing.getString(storageKey)
            }

            override fun putString(key: String, value: String) {
                mutations++
                backing.putString(key, value)
            }

            override fun remove(key: String) {
                mutations++
                backing.remove(key)
            }

            override fun flush() {
                mutations++
                backing.flush()
            }
        }
        val failingStore = GeofenceZoneStateStore(failingRead) { familyA }

        assertThrows(GeofencePersistenceException::class.java) { failingStore.load("zone-1") }
        assertThrows(GeofencePersistenceException::class.java) {
            failingStore.save(GeofenceZoneState(zoneId = "zone-1", confirmedMembership = GeofenceMembership.OUTSIDE))
        }
        assertEquals(0, mutations)
        assertEquals(raw, backing.getString(key))
    }

    @Test
    fun `reads legacy four-field state rows without inventing a sample timestamp`() {
        backing.putString(
            familyA.zoneStateStoreKey("geofence_zone_state_v2", "zone-1"),
            "INSIDE|INSIDE|0|123456789",
        )

        val state = store.load("zone-1")
        assertEquals(GeofenceMembership.INSIDE, state?.confirmedMembership)
        assertNull(state?.lastAcceptedSampleElapsedRealtimeMillis)
    }

    @Test
    fun `reads prior five-field rows and leaves boot identity unknown`() {
        backing.putString(
            familyA.zoneStateStoreKey("geofence_zone_state_v2", "zone-1"),
            "INSIDE|INSIDE|0|123456789|987654",
        )

        val state = store.load("zone-1")
        assertEquals(GeofenceMembership.INSIDE, state?.confirmedMembership)
        assertEquals(987_654L, state?.lastAcceptedSampleElapsedRealtimeMillis)
        assertNull(state?.bootInstanceId)
    }

    @Test
    fun `membership state does not follow a reused zone id into another family`() {
        store.save(GeofenceZoneState(zoneId = "zone-1", confirmedMembership = GeofenceMembership.INSIDE))
        activeScope = familyB
        assertNull(store.load("zone-1"))

        store.save(GeofenceZoneState(zoneId = "zone-1", confirmedMembership = GeofenceMembership.OUTSIDE))
        activeScope = familyA
        assertEquals(GeofenceMembership.INSIDE, store.load("zone-1")?.confirmedMembership)
        activeScope = familyB
        assertEquals(GeofenceMembership.OUTSIDE, store.load("zone-1")?.confirmedMembership)
    }

    @Test
    fun `missing trusted scope never reads or writes membership state`() {
        store.save(GeofenceZoneState(zoneId = "zone-1", confirmedMembership = GeofenceMembership.INSIDE))
        activeScope = null
        assertNull(store.load("zone-1"))
        org.junit.Assert.assertThrows(IllegalStateException::class.java) {
            store.save(GeofenceZoneState(zoneId = "zone-2"))
        }
    }

    @Test
    fun `unscoped legacy membership is not adopted into a family namespace`() {
        backing.putString("geofence_zone_state_v1_zone-1", "INSIDE|INSIDE|0|123456789")

        assertNull(store.load("zone-1"))
    }
}
