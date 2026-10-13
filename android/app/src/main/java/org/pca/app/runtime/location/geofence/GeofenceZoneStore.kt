package org.pca.app.runtime.location.geofence

import org.json.JSONArray
import org.json.JSONObject
import org.pca.app.foundation.PersistentStateStore
import org.pca.app.runtime.trustset.StrictJsonMemberNames

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
    private data class Snapshot(
        val zones: List<GeofenceZone>,
        val revisionFloors: Map<String, Long>,
        val keyEpochFloor: Long,
    )

    /** Coordinates one monitor tick with a policy replacement in this process. */
    internal fun <T> withPolicyLock(action: () -> T): T = synchronized(store.coordinationLock) { action() }

    /** Reads one identity snapshot together with the zones stored under that exact family/device. */
    fun loadScopedZones(): ScopedGeofenceZones? {
        val scope = currentScope() ?: return null
        return ScopedGeofenceZones(scope, loadZones(scope))
    }

    fun loadZones(): List<GeofenceZone> = loadScopedZones()?.zones ?: emptyList()

    internal fun loadZones(scope: GeofenceStorageScope): List<GeofenceZone> = synchronized(store.coordinationLock) {
        if (!scope.isValid()) return@synchronized emptyList()
        readSnapshot(scope).zones
    }

    fun addOrReplace(zone: GeofenceZone) {
        val scope = currentScope() ?: throw IllegalStateException("Safe Zone family authority is unavailable")
        addOrReplace(scope, zone)
    }

    internal fun addOrReplace(scope: GeofenceStorageScope, zone: GeofenceZone) = synchronized(store.coordinationLock) {
        require(scope.isValid())
        require(ZONE_TOKEN.matches(zone.zoneId)) { "Invalid Safe Zone identifier" }
        check(isCurrentScope(scope)) { "Safe Zone family authority changed" }
        val snapshot = readSnapshot(scope)
        require(zone.revision in 1L..MAX_REVISION)
        val previous = snapshot.zones.firstOrNull { it.zoneId == zone.zoneId }
        val floor = maxOf(snapshot.revisionFloors[zone.zoneId] ?: 0L, previous?.revision ?: 0L)
        check(zone.revision >= floor) { "Cannot roll back Safe Zone revision" }
        check(previous == null || zone.revision >= previous.revision) { "Cannot roll back Safe Zone revision" }
        val floors = snapshot.revisionFloors + (zone.zoneId to maxOf(floor, zone.revision))
        writeSnapshot(scope, snapshot.copy(
            zones = snapshot.zones.filterNot { it.zoneId == zone.zoneId } + zone,
            revisionFloors = floors,
        ))
    }

    /** Signed deliveries require a strictly newer revision at the write boundary. */
    internal fun addOrReplaceIfNewer(scope: GeofenceStorageScope, zone: GeofenceZone, keyEpoch: Long? = null): Boolean =
        synchronized(store.coordinationLock) {
            require(scope.isValid())
            require(ZONE_TOKEN.matches(zone.zoneId)) { "Invalid Safe Zone identifier" }
            require(zone.revision in 1L..MAX_REVISION)
            keyEpoch?.let { require(it in 1L..MAX_KEY_EPOCH) }
            check(isCurrentScope(scope)) { "Safe Zone family authority changed" }
            val snapshot = readSnapshot(scope)
            val previous = snapshot.zones.firstOrNull { it.zoneId == zone.zoneId }
            val revisionFloor = maxOf(snapshot.revisionFloors[zone.zoneId] ?: 0L, previous?.revision ?: 0L)
            if (zone.revision <= revisionFloor) return@synchronized false
            if (keyEpoch != null && keyEpoch < snapshot.keyEpochFloor) return@synchronized false
            val floors = snapshot.revisionFloors + (zone.zoneId to zone.revision)
            writeSnapshot(scope, snapshot.copy(
                zones = snapshot.zones.filterNot { it.zoneId == zone.zoneId } + zone,
                revisionFloors = floors,
                keyEpochFloor = maxOf(snapshot.keyEpochFloor, keyEpoch ?: 0L),
            ))
            true
        }

    /** Includes deleted-zone revisions so an old signed delivery cannot resurrect them. */
    internal fun revisionFloor(scope: GeofenceStorageScope, zoneId: String): Long = synchronized(store.coordinationLock) {
        if (!scope.isValid() || !ZONE_TOKEN.matches(zoneId)) return@synchronized 0L
        val snapshot = readSnapshot(scope)
        maxOf(snapshot.revisionFloors[zoneId] ?: 0L, snapshot.zones.firstOrNull { it.zoneId == zoneId }?.revision ?: 0L)
    }

    /** Family key epochs are monotonic across all Safe Zones in this local family/device scope. */
    internal fun acceptedKeyEpochFloor(scope: GeofenceStorageScope): Long = synchronized(store.coordinationLock) {
        if (!scope.isValid()) return@synchronized 0L
        readSnapshot(scope).keyEpochFloor
    }

    fun remove(zoneId: String) {
        currentScope()?.let { remove(it, zoneId) }
    }

    internal fun remove(scope: GeofenceStorageScope, zoneId: String) = synchronized(store.coordinationLock) {
        if (!scope.isValid()) return
        check(isCurrentScope(scope)) { "Safe Zone family authority changed" }
        if (!ZONE_TOKEN.matches(zoneId)) return
        val snapshot = readSnapshot(scope)
        val previous = snapshot.zones.firstOrNull { it.zoneId == zoneId } ?: return
        val floors = snapshot.revisionFloors + (zoneId to maxOf(snapshot.revisionFloors[zoneId] ?: 0L, previous.revision))
        writeSnapshot(scope, snapshot.copy(
            zones = snapshot.zones.filterNot { it.zoneId == zoneId },
            revisionFloors = floors,
        ))
    }

    fun clear() {
        currentScope()?.let { scope -> clear(scope) }
    }

    internal fun clear(scope: GeofenceStorageScope) {
        if (scope.isValid()) synchronized(store.coordinationLock) {
            check(isCurrentScope(scope)) { "Safe Zone family authority changed" }
            val snapshot = readSnapshot(scope)
            if (snapshot.revisionFloors.isEmpty() && snapshot.keyEpochFloor == 0L) {
                GeofenceDurableStorage.write(store, scope.zoneStoreKey(keyPrefix), null)
            } else {
                writeSnapshot(scope, snapshot.copy(zones = emptyList()))
            }
        }
    }

    internal fun isCurrentScope(scope: GeofenceStorageScope): Boolean = currentScope() == scope

    private fun currentScope(): GeofenceStorageScope? = runCatching { scopeProvider() }
        .getOrNull()
        ?.takeIf { it.isValid() }

    private fun readSnapshot(scope: GeofenceStorageScope): Snapshot {
        val raw = try { GeofenceDurableStorage.read(store, scope.zoneStoreKey(keyPrefix)) }
            catch (_: GeofencePersistenceException) { throw CorruptGeofenceZoneStoreException() }
            ?: return Snapshot(emptyList(), emptyMap(), 0L)
        if (raw.isEmpty()) return Snapshot(emptyList(), emptyMap(), 0L)
        return try {
            if (raw.startsWith("{")) decodeSnapshot(raw) else decodeLegacyZones(raw)
        } catch (_: Exception) {
            throw CorruptGeofenceZoneStoreException()
        }
    }

    private fun decodeLegacyZones(raw: String): Snapshot {
        val zones = raw.split(ZONE_SEP).map { encoded ->
            decodeZone(encoded) ?: throw IllegalArgumentException("corrupt Safe Zone row")
        }
        require(zones.map { it.zoneId }.distinct().size == zones.size)
        return Snapshot(zones, zones.associate { it.zoneId to it.revision }, 0L)
    }

    private fun decodeSnapshot(raw: String): Snapshot {
        StrictJsonMemberNames.requireUnique(raw)
        val json = JSONObject(raw)
        require(json.keys().asSequence().toSet() == SNAPSHOT_KEYS && json.getString("format") == SNAPSHOT_FORMAT)
        val zonesJson = json.getJSONArray("zones")
        val zones = (0 until zonesJson.length()).map { index ->
            decodeZone(zonesJson.getString(index)) ?: throw IllegalArgumentException("corrupt Safe Zone row")
        }
        require(zones.map { it.zoneId }.distinct().size == zones.size)
        val floorJson = json.getJSONArray("revisionFloors")
        val floors = LinkedHashMap<String, Long>()
        for (index in 0 until floorJson.length()) {
            val row = floorJson.getJSONObject(index)
            require(row.keys().asSequence().toSet() == REVISION_FLOOR_KEYS)
            val id = row.getString("zoneId")
            require(ZONE_TOKEN.matches(id))
            val revision = positiveLong(row.getString("revision"), MAX_REVISION)
            require(floors.put(id, revision) == null)
        }
        for (zone in zones) require((floors[zone.zoneId] ?: 0L) >= zone.revision)
        val keyEpochFloor = nonNegativeLong(json.getString("keyEpochFloor"), MAX_KEY_EPOCH)
        return Snapshot(zones, floors, keyEpochFloor)
    }

    private fun writeSnapshot(scope: GeofenceStorageScope, snapshot: Snapshot) {
        require(scope.isValid())
        require(snapshot.zones.map { it.zoneId }.distinct().size == snapshot.zones.size)
        require(snapshot.zones.all { ZONE_TOKEN.matches(it.zoneId) && it.revision in 1L..MAX_REVISION })
        require(snapshot.revisionFloors.all { (id, revision) -> ZONE_TOKEN.matches(id) && revision in 1L..MAX_REVISION })
        require(snapshot.zones.all { (snapshot.revisionFloors[it.zoneId] ?: 0L) >= it.revision })
        require(snapshot.keyEpochFloor in 0L..MAX_KEY_EPOCH)
        val zones = JSONArray().apply { snapshot.zones.forEach { put(encodeZone(it)) } }
        val floors = JSONArray().apply {
            snapshot.revisionFloors.toSortedMap().forEach { (id, revision) ->
                put(JSONObject().put("zoneId", id).put("revision", revision.toString()))
            }
        }
        val raw = JSONObject().put("format", SNAPSHOT_FORMAT).put("zones", zones)
            .put("revisionFloors", floors).put("keyEpochFloor", snapshot.keyEpochFloor.toString()).toString()
        GeofenceDurableStorage.write(store, scope.zoneStoreKey(keyPrefix), raw)
    }

    private fun positiveLong(value: String, maximum: Long): Long =
        nonNegativeLong(value, maximum).also { require(it > 0L) }

    private fun nonNegativeLong(value: String, maximum: Long): Long {
        require(DECIMAL.matches(value))
        return value.toLong().also { require(it <= maximum) }
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
        if (!ZONE_TOKEN.matches(parts[0])) return null
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
        val ZONE_TOKEN = Regex("^[A-Za-z0-9_-]{1,128}$")
        val DECIMAL = Regex("^(0|[1-9][0-9]*)$")
        val SNAPSHOT_KEYS = setOf("format", "zones", "revisionFloors", "keyEpochFloor")
        val REVISION_FLOOR_KEYS = setOf("zoneId", "revision")
        const val SNAPSHOT_FORMAT = "safe-zone-v3"
        const val MAX_REVISION = 4_294_967_295L
        const val MAX_KEY_EPOCH = Int.MAX_VALUE.toLong()
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
