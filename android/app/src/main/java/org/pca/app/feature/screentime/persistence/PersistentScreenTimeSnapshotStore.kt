package org.pca.app.feature.screentime.persistence

import org.pca.app.feature.screentime.engine.ScreenTimeMode
import org.pca.app.feature.screentime.engine.ScreenTimeState
import org.pca.app.foundation.PersistentStateStore

/**
 * Coordinator integration adapter: backs PCA-3's [ScreenTimeSnapshotStore] port with PCA-2's
 * generic [PersistentStateStore] (durable, OS-backed at-rest protection -- doc 09 Section 7),
 * replacing the in-memory reference implementation used during standalone lane development.
 *
 * [PersistentStateStore] is string-keyed/valued only, so [ScreenTimeSnapshot] is serialized to
 * a single delimited line. There is exactly one free-form field ([ScreenTimeSnapshot.bootId]);
 * it is placed last and read back with a limited split, so it may safely contain the delimiter
 * itself without corrupting the encoding -- no other field is ever user- or platform-supplied
 * free text.
 */
class PersistentScreenTimeSnapshotStore(
    private val store: PersistentStateStore,
    private val key: String = KEY,
) : ScreenTimeSnapshotStore {

    override fun save(snapshot: ScreenTimeSnapshot) {
        store.putString(key, encode(snapshot))
    }

    override fun load(): ScreenTimeSnapshot? {
        val raw = store.getString(key) ?: return null
        return decode(raw)
    }

    internal fun encode(snapshot: ScreenTimeSnapshot): String {
        val s = snapshot.state
        val fields = listOf(
            s.mode.name,
            s.activeElapsedNanos.toString(),
            s.breakElapsedNanos.toString(),
            s.pauseElapsedNanos.toString(),
            s.dhikrInteractionCount.toString(),
            s.completedBreakCount.toString(),
            s.overriddenBreakCount.toString(),
            s.lastTickMonotonicNanos.toString(),
            s.preEmergencyMode?.name ?: NULL_SENTINEL,
            s.preEmergencyActiveElapsedNanos.toString(),
            s.preEmergencyBreakElapsedNanos.toString(),
            s.preEmergencyPauseElapsedNanos.toString(),
            snapshot.snapshotWallClockMillis.toString(),
            snapshot.bootId ?: NULL_SENTINEL,
        )
        return fields.joinToString(FIELD_SEPARATOR)
    }

    internal fun decode(raw: String): ScreenTimeSnapshot? {
        val parts = raw.split(FIELD_SEPARATOR, limit = FIELD_COUNT)
        if (parts.size != FIELD_COUNT) return null
        return try {
            val state = ScreenTimeState(
                mode = ScreenTimeMode.valueOf(parts[0]),
                activeElapsedNanos = parts[1].toLong(),
                breakElapsedNanos = parts[2].toLong(),
                pauseElapsedNanos = parts[3].toLong(),
                dhikrInteractionCount = parts[4].toInt(),
                completedBreakCount = parts[5].toInt(),
                overriddenBreakCount = parts[6].toInt(),
                lastTickMonotonicNanos = parts[7].toLong(),
                preEmergencyMode = parts[8].takeIf { it != NULL_SENTINEL }?.let { ScreenTimeMode.valueOf(it) },
                preEmergencyActiveElapsedNanos = parts[9].toLong(),
                preEmergencyBreakElapsedNanos = parts[10].toLong(),
                preEmergencyPauseElapsedNanos = parts[11].toLong(),
            )
            ScreenTimeSnapshot(
                state = state,
                snapshotWallClockMillis = parts[12].toLong(),
                bootId = parts[13].takeIf { it != NULL_SENTINEL },
            )
        } catch (_: IllegalArgumentException) {
            // Malformed/corrupt persisted value (e.g. an enum name from a future app version
            // this build doesn't know) -- fail safe to "no snapshot" rather than crash; the
            // engine's own restoration fallback (fresh Idle state) takes over from there.
            null
        }
    }

    private companion object {
        const val KEY = "screen_time_snapshot_v1"
        const val FIELD_SEPARATOR = "|"
        const val FIELD_COUNT = 14
        const val NULL_SENTINEL = "NULL"
    }
}
