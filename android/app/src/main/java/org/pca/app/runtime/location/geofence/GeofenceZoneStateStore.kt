package org.pca.app.runtime.location.geofence

import org.pca.app.foundation.PersistentStateStore

/**
 * Durable local storage for each zone's [GeofenceZoneState] (confirmed membership + in-progress
 * debounce candidate), keyed per zone so an unrelated zone's state is never disturbed by writing
 * another's. Persisting this (rather than keeping it only in memory) matters because
 * [GeofenceEngine]'s hysteresis/debounce logic depends on the PREVIOUS confirmed membership --
 * without durability, a process restart would reset every zone to [GeofenceMembership.UNKNOWN] and
 * (correctly, per [GeofenceEngine]'s cold-start rule, but wastefully) suppress the very next real
 * transition's alert.
 */
class GeofenceZoneStateStore(
    private val store: PersistentStateStore,
) {
    fun load(zoneId: String): GeofenceZoneState? {
        val raw = store.getString(keyFor(zoneId)) ?: return null
        return decode(zoneId, raw)
    }

    fun save(state: GeofenceZoneState) {
        store.putString(keyFor(state.zoneId), encode(state))
    }

    fun clear(zoneId: String) {
        store.remove(keyFor(zoneId))
    }

    private fun keyFor(zoneId: String) = "$KEY_PREFIX$zoneId"

    private fun encode(state: GeofenceZoneState): String = listOf(
        state.confirmedMembership.name,
        state.candidateMembership.name,
        state.candidateStreak.toString(),
        state.lastEvaluatedMonotonicNanos.toString(),
    ).joinToString(SEP)

    private fun decode(zoneId: String, raw: String): GeofenceZoneState? {
        val parts = raw.split(SEP)
        if (parts.size != FIELD_COUNT) return null
        return try {
            GeofenceZoneState(
                zoneId = zoneId,
                confirmedMembership = GeofenceMembership.valueOf(parts[0]),
                candidateMembership = GeofenceMembership.valueOf(parts[1]),
                candidateStreak = parts[2].toInt(),
                lastEvaluatedMonotonicNanos = parts[3].toLong(),
            )
        } catch (_: IllegalArgumentException) {
            null
        }
    }

    private companion object {
        const val KEY_PREFIX = "geofence_zone_state_v1_"
        const val SEP = "|"
        const val FIELD_COUNT = 4
    }
}
