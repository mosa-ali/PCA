package org.pca.app.runtime.location.geofence

import org.pca.app.foundation.PersistentStateStore

/**
 * Durable local storage for each zone's [GeofenceZoneState] (confirmed membership + in-progress
 * debounce candidate), keyed by family, device, and zone so another identity cannot inherit this
 * device's state. Persisting this (rather than keeping it only in memory) matters because
 * [GeofenceEngine]'s hysteresis/debounce logic depends on the PREVIOUS confirmed membership --
 * without durability, a process restart would reset every zone to [GeofenceMembership.UNKNOWN] and
 * (correctly, per [GeofenceEngine]'s cold-start rule, but wastefully) suppress the very next real
 * transition's alert.
 */
class GeofenceZoneStateStore(
    private val store: PersistentStateStore,
    private val scopeProvider: () -> GeofenceStorageScope?,
) {
    fun load(zoneId: String): GeofenceZoneState? {
        val scope = currentScope() ?: return null
        return load(scope, zoneId)
    }

    fun save(state: GeofenceZoneState) {
        val scope = currentScope() ?: throw IllegalStateException("Safe Zone family authority is unavailable")
        save(scope, state)
    }

    fun clear(zoneId: String) {
        currentScope()?.let { clear(it, zoneId) }
    }

    internal fun load(scope: GeofenceStorageScope, zoneId: String): GeofenceZoneState? {
        if (!scope.isValid() || !ZONE_TOKEN.matches(zoneId)) return null
        val raw = store.getString(scope.zoneStateStoreKey(KEY_PREFIX, zoneId)) ?: return null
        return decode(zoneId, raw)
    }

    internal fun save(scope: GeofenceStorageScope, state: GeofenceZoneState) {
        require(scope.isValid() && ZONE_TOKEN.matches(state.zoneId))
        store.putString(scope.zoneStateStoreKey(KEY_PREFIX, state.zoneId), encode(state))
    }

    internal fun clear(scope: GeofenceStorageScope, zoneId: String) {
        if (scope.isValid() && ZONE_TOKEN.matches(zoneId)) {
            store.remove(scope.zoneStateStoreKey(KEY_PREFIX, zoneId))
        }
    }

    private fun currentScope(): GeofenceStorageScope? = runCatching { scopeProvider() }
        .getOrNull()
        ?.takeIf { it.isValid() }

    private fun encode(state: GeofenceZoneState): String = listOf(
        state.confirmedMembership.name,
        state.candidateMembership.name,
        state.candidateStreak.toString(),
        state.lastEvaluatedMonotonicNanos.toString(),
        state.lastAcceptedSampleElapsedRealtimeMillis?.toString() ?: "-",
    ).joinToString(SEP)

    private fun decode(zoneId: String, raw: String): GeofenceZoneState? {
        val parts = raw.split(SEP)
        if (parts.size != LEGACY_FIELD_COUNT && parts.size != FIELD_COUNT) return null
        return try {
            GeofenceZoneState(
                zoneId = zoneId,
                confirmedMembership = GeofenceMembership.valueOf(parts[0]),
                candidateMembership = GeofenceMembership.valueOf(parts[1]),
                candidateStreak = parts[2].toInt(),
                lastEvaluatedMonotonicNanos = parts[3].toLong(),
                lastAcceptedSampleElapsedRealtimeMillis = parts.getOrNull(4)?.takeUnless { it == "-" }?.toLong(),
            )
        } catch (_: IllegalArgumentException) {
            null
        }
    }

    private companion object {
        const val KEY_PREFIX = "geofence_zone_state_v2"
        val ZONE_TOKEN = Regex("^[A-Za-z0-9_-]{1,128}$")
        const val SEP = "|"
        const val LEGACY_FIELD_COUNT = 4
        const val FIELD_COUNT = 5
    }
}
