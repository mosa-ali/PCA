package org.pca.app.runtime.location.geofence

import org.pca.app.foundation.PersistentStateStore

/** A persisted zone snapshot is ambiguous and must not be partially enforced or overwritten. */
class CorruptGeofenceZoneStoreException : IllegalStateException("Safe Zone policy snapshot is corrupt")

/**
 * Durable local storage for the parent-defined [GeofenceZone] list (PCA-FR-063), partitioned by
 * the locally persisted family projection and enrolled device. An unscoped, missing, non-paired/
 * non-active, or corrupt enrollment identity cannot read or write any policy namespace. This
 * local scope does not refresh server status. Backed by the
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
    private val scopeProvider: () -> GeofenceStorageScope?,
    private val keyPrefix: String = KEY_PREFIX,
) {
    /** Reads one identity snapshot together with the zones stored under that exact family/device. */
    fun loadScopedZones(): ScopedGeofenceZones? {
        val scope = currentScope() ?: return null
        return ScopedGeofenceZones(scope, loadZones(scope))
    }

    fun loadZones(): List<GeofenceZone> = loadScopedZones()?.zones ?: emptyList()

    internal fun loadZones(scope: GeofenceStorageScope): List<GeofenceZone> {
        if (!scope.isValid()) return emptyList()
        val raw = store.getString(scope.zoneStoreKey(keyPrefix)) ?: return emptyList()
        if (raw.isEmpty()) return emptyList()
        val zones = raw.split(ZONE_SEP).map { encoded ->
            decodeZone(encoded) ?: throw CorruptGeofenceZoneStoreException()
        }
        if (zones.map { it.zoneId }.distinct().size != zones.size) {
            throw CorruptGeofenceZoneStoreException()
        }
        return zones
    }

    fun addOrReplace(zone: GeofenceZone) {
        val scope = currentScope() ?: throw IllegalStateException("Safe Zone family authority is unavailable")
        addOrReplace(scope, zone)
    }

    internal fun addOrReplace(scope: GeofenceStorageScope, zone: GeofenceZone) {
        require(scope.isValid())
        val updated = loadZones(scope).filterNot { it.zoneId == zone.zoneId } + zone
        saveZones(scope, updated)
    }

    fun remove(zoneId: String) {
        currentScope()?.let { remove(it, zoneId) }
    }

    internal fun remove(scope: GeofenceStorageScope, zoneId: String) {
        if (!scope.isValid()) return
        saveZones(scope, loadZones(scope).filterNot { it.zoneId == zoneId })
    }

    fun clear() {
        currentScope()?.let { scope -> clear(scope) }
    }

    internal fun clear(scope: GeofenceStorageScope) {
        if (scope.isValid()) store.remove(scope.zoneStoreKey(keyPrefix))
    }

    internal fun isCurrentScope(scope: GeofenceStorageScope): Boolean = currentScope() == scope

    private fun currentScope(): GeofenceStorageScope? = runCatching { scopeProvider() }
        .getOrNull()
        ?.takeIf { it.isValid() }

    private fun saveZones(scope: GeofenceStorageScope, zones: List<GeofenceZone>) {
        val scopedKey = scope.zoneStoreKey(keyPrefix)
        if (zones.isEmpty()) {
            store.remove(scopedKey)
            return
        }
        store.putString(scopedKey, zones.joinToString(ZONE_SEP) { encodeZone(it) })
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
        zone.enabled.toString(),
        zone.transitionTypes.map { it.name }.sorted().joinToString(TRANSITION_SEP),
        zone.revision.toString(),
    ).joinToString(FIELD_SEP)

    private fun sanitize(value: String): String = value.replace(FIELD_SEP, " ").replace(ZONE_SEP, " ")

    private fun decodeZone(raw: String): GeofenceZone? {
        val parts = raw.split(FIELD_SEP)
        if (parts.size != LEGACY_FIELD_COUNT && parts.size != ENABLED_FIELD_COUNT && parts.size != FIELD_COUNT) return null
        return try {
            val enabled = if (parts.size == LEGACY_FIELD_COUNT) {
                true
            } else {
                when (parts[5]) {
                    "true" -> true
                    "false" -> false
                    else -> return null
                }
            }
            val transitions = if (parts.size == LEGACY_FIELD_COUNT) {
                DEFAULT_TRANSITIONS
            } else {
                parts[6].split(TRANSITION_SEP).mapNotNull { value ->
                    runCatching { GeofenceTransitionType.valueOf(value) }.getOrNull()
                }.toSet().takeIf { it.size == parts[6].split(TRANSITION_SEP).size && it.isNotEmpty() }
                    ?: return null
            }
            val revision = if (parts.size < FIELD_COUNT) {
                1L
            } else {
                parts[7].toLong().takeIf { it > 0L } ?: return null
            }
            GeofenceZone(
                zoneId = parts[0],
                label = parts[1],
                centerLatitude = parts[2].toDouble(),
                centerLongitude = parts[3].toDouble(),
                radiusMeters = parts[4].toDouble(),
                enabled = enabled,
                transitionTypes = transitions,
                revision = revision,
            )
        } catch (_: IllegalArgumentException) {
            null
        }
    }

    private companion object {
        const val KEY_PREFIX = "geofence_zones_v2"
        const val ZONE_SEP = "\n"
        const val FIELD_SEP = "|"
        const val TRANSITION_SEP = ","
        const val LEGACY_FIELD_COUNT = 5
        const val ENABLED_FIELD_COUNT = 7
        const val FIELD_COUNT = 8
        val DEFAULT_TRANSITIONS = setOf(GeofenceTransitionType.ENTRY, GeofenceTransitionType.EXIT)
    }
}
