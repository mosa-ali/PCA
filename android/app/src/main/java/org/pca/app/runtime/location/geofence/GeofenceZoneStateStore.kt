package org.pca.app.runtime.location.geofence

import org.pca.app.foundation.PersistentStateStore

/** Persisted debounce state was present but unreadable, so it cannot safely be treated as absent. */
class CorruptGeofenceZoneStateException : IllegalStateException("Safe Zone debounce state is unreadable")

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
        val raw = GeofenceDurableStorage.read(store, scope.zoneStateStoreKey(KEY_PREFIX, zoneId)) ?: return null
        return decode(zoneId, raw) ?: throw CorruptGeofenceZoneStateException()
    }

    internal fun save(scope: GeofenceStorageScope, state: GeofenceZoneState) {
        require(scope.isValid() && ZONE_TOKEN.matches(state.zoneId))
        require(isSane(state)) { "Invalid Safe Zone debounce state" }
        synchronized(store.coordinationLock) {
            check(currentScope() == scope) { "Safe Zone family authority changed" }
            val key = scope.zoneStateStoreKey(KEY_PREFIX, state.zoneId)
            val existing = GeofenceDurableStorage.read(store, key)
            if (existing != null && decode(state.zoneId, existing) == null) {
                throw CorruptGeofenceZoneStateException()
            }
            GeofenceDurableStorage.write(store, key, encode(state))
        }
    }

    internal fun clear(scope: GeofenceStorageScope, zoneId: String) {
        if (scope.isValid() && ZONE_TOKEN.matches(zoneId)) {
            synchronized(store.coordinationLock) {
                check(currentScope() == scope) { "Safe Zone family authority changed" }
                GeofenceDurableStorage.write(store, scope.zoneStateStoreKey(KEY_PREFIX, zoneId), null)
            }
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
        state.bootInstanceId ?: "-",
    ).joinToString(SEP)

    private fun decode(zoneId: String, raw: String): GeofenceZoneState? {
        val parts = raw.split(SEP)
        if (parts.size != LEGACY_FIELD_COUNT && parts.size != FIELD_COUNT && parts.size != BOOT_FIELD_COUNT) return null
        return try {
            val state = GeofenceZoneState(
                zoneId = zoneId,
                confirmedMembership = GeofenceMembership.valueOf(parts[0]),
                candidateMembership = GeofenceMembership.valueOf(parts[1]),
                candidateStreak = parts[2].toInt(),
                lastEvaluatedMonotonicNanos = parts[3].toLong(),
                lastAcceptedSampleElapsedRealtimeMillis = parts.getOrNull(4)?.takeUnless { it == "-" }?.toLong(),
                bootInstanceId = parts.getOrNull(5)?.takeUnless { it == "-" },
            )
            state.takeIf(::isSane)
        } catch (_: IllegalArgumentException) {
            null
        }
    }

    private fun isSane(state: GeofenceZoneState): Boolean =
        state.candidateStreak >= 0 && state.lastEvaluatedMonotonicNanos >= 0L &&
            (state.lastAcceptedSampleElapsedRealtimeMillis == null || state.lastAcceptedSampleElapsedRealtimeMillis >= 0L) &&
            (state.bootInstanceId == null || BOOT_TOKEN.matches(state.bootInstanceId)) &&
            (state.candidateStreak == 0 ||
                (state.candidateMembership != GeofenceMembership.UNKNOWN &&
                    state.candidateMembership != state.confirmedMembership))

    private companion object {
        const val KEY_PREFIX = "geofence_zone_state_v2"
        val ZONE_TOKEN = Regex("^[A-Za-z0-9_-]{1,128}$")
        const val SEP = "|"
        const val LEGACY_FIELD_COUNT = 4
        const val FIELD_COUNT = 5
        const val BOOT_FIELD_COUNT = 6
        val BOOT_TOKEN = Regex("^[A-Za-z0-9_-]{1,128}$")
    }
}
