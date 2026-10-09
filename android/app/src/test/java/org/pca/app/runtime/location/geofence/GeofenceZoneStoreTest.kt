package org.pca.app.runtime.location.geofence

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.pca.app.foundation.InMemoryPersistentStateStore

class GeofenceZoneStoreTest {

    private val backing = InMemoryPersistentStateStore()
    private val familyA = GeofenceStorageScope("family-a", "device-a")
    private val familyB = GeofenceStorageScope("family-b", "device-b")
    private var activeScope: GeofenceStorageScope? = familyA
    private val store = GeofenceZoneStore(backing, scopeProvider = { activeScope })

    private fun zone(id: String, label: String = "Zone $id") =
        GeofenceZone(zoneId = id, label = label, centerLatitude = 25.0, centerLongitude = 55.0, radiusMeters = 100.0)

    @Test
    fun `empty store returns no zones`() {
        assertTrue(store.loadZones().isEmpty())
    }

    @Test
    fun `round-trips a single zone`() {
        store.addOrReplace(zone("home"))
        val zones = store.loadZones()
        assertEquals(1, zones.size)
        assertEquals("home", zones.first().zoneId)
        assertEquals(100.0, zones.first().radiusMeters, 0.0)
    }

    @Test
    fun `round-trips multiple zones`() {
        store.addOrReplace(zone("home"))
        store.addOrReplace(zone("school"))
        val ids = store.loadZones().map { it.zoneId }.toSet()
        assertEquals(setOf("home", "school"), ids)
    }

    @Test
    fun `addOrReplace with an existing id replaces rather than duplicates`() {
        store.addOrReplace(zone("home", "Home v1"))
        store.addOrReplace(zone("home", "Home v2"))
        val zones = store.loadZones()
        assertEquals(1, zones.size)
        assertEquals("Home v2", zones.first().label)
    }

    @Test
    fun `remove deletes only the targeted zone`() {
        store.addOrReplace(zone("home"))
        store.addOrReplace(zone("school"))
        store.remove("home")
        val ids = store.loadZones().map { it.zoneId }
        assertEquals(listOf("school"), ids)
    }

    @Test
    fun `label containing the field delimiter is sanitized, never corrupts the record`() {
        store.addOrReplace(zone("home", "Grandma's | House"))
        val zones = store.loadZones()
        assertEquals(1, zones.size)
        assertEquals("home", zones.first().zoneId)
    }

    @Test
    fun `clear removes all zones`() {
        store.addOrReplace(zone("home"))
        store.clear()
        assertTrue(store.loadZones().isEmpty())
    }

    @Test
    fun `corrupt raw value is rejected rather than partially decoded`() {
        backing.putString(familyA.zoneStoreKey("geofence_zones_v2"), "not|enough|fields")
        org.junit.Assert.assertThrows(CorruptGeofenceZoneStoreException::class.java) {
            store.loadZones()
        }
    }

    @Test
    fun `partially corrupt policy snapshot fails closed across store recreation and is not overwritten`() {
        val key = familyA.zoneStoreKey("geofence_zones_v2")
        val valid = "home|Home|25.0|55.0|100.0|true|ENTRY,EXIT|1"
        val corrupt = "$valid\nnot|enough|fields"
        backing.putString(key, corrupt)

        val restarted = GeofenceZoneStore(backing, scopeProvider = { activeScope })
        org.junit.Assert.assertThrows(CorruptGeofenceZoneStoreException::class.java) {
            restarted.loadZones()
        }
        org.junit.Assert.assertThrows(CorruptGeofenceZoneStoreException::class.java) {
            restarted.addOrReplace(zone("school"))
        }

        assertEquals(corrupt, backing.getString(key))
    }

    @Test
    fun `duplicate zone ids in persisted snapshot fail closed`() {
        val key = familyA.zoneStoreKey("geofence_zones_v2")
        val duplicateIds = listOf(
            "home|Home A|25.0|55.0|100.0|true|ENTRY,EXIT|1",
            "home|Home B|25.1|55.1|100.0|true|ENTRY,EXIT|2",
        ).joinToString("\n")
        backing.putString(key, duplicateIds)

        org.junit.Assert.assertThrows(CorruptGeofenceZoneStoreException::class.java) {
            store.loadZones()
        }
    }

    @Test
    fun `policy snapshots remain isolated by family and device across store recreation`() {
        store.addOrReplace(zone("home", "Family A home"))
        activeScope = familyB
        store.addOrReplace(zone("home", "Family B home"))

        assertEquals("Family B home", store.loadZones().single().label)
        activeScope = familyA
        assertEquals("Family A home", store.loadZones().single().label)

        activeScope = familyB
        val restarted = GeofenceZoneStore(backing, scopeProvider = { activeScope })
        assertEquals("Family B home", restarted.loadZones().single().label)
    }

    @Test
    fun `missing or malformed family scope fails closed and cannot write`() {
        activeScope = null
        assertTrue(store.loadZones().isEmpty())
        org.junit.Assert.assertThrows(IllegalStateException::class.java) {
            store.addOrReplace(zone("home"))
        }

        activeScope = GeofenceStorageScope(" ", "device-a")
        assertTrue(store.loadZones().isEmpty())
    }

    @Test
    fun `unscoped legacy policy is not adopted into a family namespace`() {
        backing.putString("geofence_zones_v1", "home|Legacy|25.0|55.0|100.0|true|ENTRY,EXIT|1")

        assertTrue(store.loadZones().isEmpty())
    }
}
