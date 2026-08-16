package org.pca.app.runtime.location.geofence

import org.pca.app.foundation.PersistentStateStore

/**
 * Durable local storage for the parent-defined [GeofenceZone] list (PCA-FR-063). Backed by the
 * same [PersistentStateStore] port every other feature store in this codebase uses -- the
 * production binding is `EncryptedSharedPreferencesStateStore` (Android-Keystore-backed at-rest
 * protection), so zone centers get the same at-rest protection as every other locally-stored value
 * here, without this class needing to know or care which concrete store it was handed.
 *
 * Deliberately no zone-management UI is built alongside this store (mission: "not a full
 * zone-management UI unless time allows") -- [addOrReplace]/[remove] are the complete zone-authoring
 * surface for now, ready for a future UI layer to call directly.
 */
class GeofenceZoneStore(
    private val store: PersistentStateStore,
    private val key: String = KEY,
) {
    fun loadZones(): List<GeofenceZone> {
        val raw = store.getString(key) ?: return emptyList()
        if (raw.isEmpty()) return emptyList()
        return raw.split(ZONE_SEP).mapNotNull { decodeZone(it) }
    }

    fun addOrReplace(zone: GeofenceZone) {
        val updated = loadZones().filterNot { it.zoneId == zone.zoneId } + zone
        saveZones(updated)
    }

    fun remove(zoneId: String) {
        saveZones(loadZones().filterNot { it.zoneId == zoneId })
    }

    fun clear() {
        store.remove(key)
    }

    private fun saveZones(zones: List<GeofenceZone>) {
        if (zones.isEmpty()) {
            store.remove(key)
            return
        }
        store.putString(key, zones.joinToString(ZONE_SEP) { encodeZone(it) })
    }

    // zoneId/label may never legitimately contain FIELD_SEP or ZONE_SEP -- sanitized defensively
    // at encode time rather than via a general escape/unescape scheme (a mis-implemented pair of
    // those is a classic source of silent data corruption; stripping is simpler and can't corrupt).
    private fun encodeZone(zone: GeofenceZone): String = listOf(
        sanitize(zone.zoneId),
        sanitize(zone.label),
        zone.centerLatitude.toString(),
        zone.centerLongitude.toString(),
        zone.radiusMeters.toString(),
    ).joinToString(FIELD_SEP)

    private fun sanitize(value: String): String = value.replace(FIELD_SEP, " ").replace(ZONE_SEP, " ")

    private fun decodeZone(raw: String): GeofenceZone? {
        val parts = raw.split(FIELD_SEP)
        if (parts.size != FIELD_COUNT) return null
        return try {
            GeofenceZone(
                zoneId = parts[0],
                label = parts[1],
                centerLatitude = parts[2].toDouble(),
                centerLongitude = parts[3].toDouble(),
                radiusMeters = parts[4].toDouble(),
            )
        } catch (_: IllegalArgumentException) {
            null
        }
    }

    private companion object {
        const val KEY = "geofence_zones_v1"
        const val ZONE_SEP = "\n"
        const val FIELD_SEP = "|"
        const val FIELD_COUNT = 5
    }
}
