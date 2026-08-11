package org.pca.app.feature.eyedistance.persistence

import org.pca.app.feature.eyedistance.engine.EyeDistancePhase
import org.pca.app.feature.eyedistance.engine.EyeDistanceState
import org.pca.app.foundation.PersistentStateStore

/**
 * Coordinator integration adapter: backs [EyeDistanceSnapshotStore] with PCA-2's generic
 * [PersistentStateStore] -- identical pattern to PCA-3's `PersistentScreenTimeSnapshotStore`.
 * Doc 13 privacy boundary: only the bounded outcome fields below are ever persisted here --
 * no raw sensor stream, camera frame, landmark, or biometric data has a field to serialize into
 * in the first place, since [EyeDistanceState] itself never carries any.
 */
class PersistentEyeDistanceSnapshotStore(
    private val store: PersistentStateStore,
    private val key: String = KEY,
) : EyeDistanceSnapshotStore {

    override fun save(snapshot: EyeDistanceSnapshot) {
        store.putString(key, encode(snapshot))
    }

    override fun load(): EyeDistanceSnapshot? {
        val raw = store.getString(key) ?: return null
        return decode(raw)
    }

    internal fun encode(snapshot: EyeDistanceSnapshot): String {
        val s = snapshot.state
        val fields = listOf(
            s.phase.name,
            s.nearElapsedNanos.toString(),
            s.farElapsedNanos.toString(),
            s.unknownElapsedNanos.toString(),
            s.restElapsedNanos.toString(),
            s.warningEpisodeTimestampsNanos.joinToString(EPISODE_SEPARATOR),
            s.lastTickMonotonicNanos.toString(),
            s.preSuspendPhase?.name ?: NULL_SENTINEL,
            s.exceptionActive.toString(),
            s.preExceptionPhase?.name ?: NULL_SENTINEL,
            snapshot.snapshotWallClockMillis.toString(),
            snapshot.bootId ?: NULL_SENTINEL,
        )
        return fields.joinToString(FIELD_SEPARATOR)
    }

    internal fun decode(raw: String): EyeDistanceSnapshot? {
        val parts = raw.split(FIELD_SEPARATOR, limit = FIELD_COUNT)
        if (parts.size != FIELD_COUNT) return null
        return try {
            val episodes = parts[5].takeIf { it.isNotEmpty() }
                ?.split(EPISODE_SEPARATOR)
                ?.map { it.toLong() }
                ?: emptyList()
            val state = EyeDistanceState(
                phase = EyeDistancePhase.valueOf(parts[0]),
                nearElapsedNanos = parts[1].toLong(),
                farElapsedNanos = parts[2].toLong(),
                unknownElapsedNanos = parts[3].toLong(),
                restElapsedNanos = parts[4].toLong(),
                warningEpisodeTimestampsNanos = episodes,
                lastTickMonotonicNanos = parts[6].toLong(),
                preSuspendPhase = parts[7].takeIf { it != NULL_SENTINEL }?.let { EyeDistancePhase.valueOf(it) },
                exceptionActive = parts[8].toBoolean(),
                preExceptionPhase = parts[9].takeIf { it != NULL_SENTINEL }?.let { EyeDistancePhase.valueOf(it) },
            )
            EyeDistanceSnapshot(
                state = state,
                snapshotWallClockMillis = parts[10].toLong(),
                bootId = parts[11].takeIf { it != NULL_SENTINEL },
            )
        } catch (_: IllegalArgumentException) {
            // Malformed/corrupt persisted value -- fail safe to "no snapshot" rather than crash;
            // the caller's own fallback (a fresh UNAVAILABLE/MONITORING state) takes over.
            null
        }
    }

    private companion object {
        const val KEY = "eye_distance_snapshot_v1"
        const val FIELD_SEPARATOR = "|"
        const val EPISODE_SEPARATOR = ","
        const val FIELD_COUNT = 12
        const val NULL_SENTINEL = "NULL"
    }
}
