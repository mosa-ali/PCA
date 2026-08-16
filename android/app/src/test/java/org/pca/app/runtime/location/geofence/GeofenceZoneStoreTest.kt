package org.pca.app.runtime.location.geofence

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.pca.app.foundation.InMemoryPersistentStateStore

class GeofenceZoneStoreTest {

    private val backing = InMemoryPersistentStateStore()
    private val store = GeofenceZoneStore(backing)

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
    fun `corrupt raw value degrades to empty rather than crashing`() {
        backing.putString("geofence_zones_v1", "not|enough|fields")
        assertTrue(store.loadZones().isEmpty())
    }
}
