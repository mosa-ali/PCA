package org.pca.app.runtime.location.geofence

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.pca.app.foundation.InMemoryPersistentStateStore

class GeofenceZoneStateStoreTest {

    private val backing = InMemoryPersistentStateStore()
    private val store = GeofenceZoneStateStore(backing)

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
    fun `corrupt raw value degrades to null rather than crashing`() {
        backing.putString("geofence_zone_state_v1_zone-1", "garbage")
        assertNull(store.load("zone-1"))
    }
}
