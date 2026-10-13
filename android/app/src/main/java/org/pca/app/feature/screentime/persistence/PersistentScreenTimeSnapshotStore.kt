package org.pca.app.feature.screentime.persistence

import org.pca.app.feature.screentime.engine.ScreenTimeMode
import org.pca.app.feature.screentime.engine.ScreenTimeState
import org.pca.app.foundation.PersistentStateStore
import java.util.concurrent.CancellationException

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

    override fun load(): ScreenTimeSnapshot? = when (val result = read()) {
        ScreenTimeSnapshotRead.Absent, ScreenTimeSnapshotRead.Corrupt -> null
        is ScreenTimeSnapshotRead.Present -> result.snapshot
    }

    override fun read(): ScreenTimeSnapshotRead {
        val raw = try {
            store.getString(key)
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            return ScreenTimeSnapshotRead.Corrupt
        } ?: return ScreenTimeSnapshotRead.Absent

        val snapshot = decode(raw) ?: return ScreenTimeSnapshotRead.Corrupt
        return ScreenTimeSnapshotRead.Present(snapshot)
    }

    internal fun encode(snapshot: ScreenTimeSnapshot): String {
        val s = snapshot.state
        val fields = listOf(
            VERSION_3,
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
            s.preCommunicationMode?.name ?: NULL_SENTINEL,
            s.preCommunicationActiveElapsedNanos.toString(),
            s.preCommunicationBreakElapsedNanos.toString(),
            s.preCommunicationPauseElapsedNanos.toString(),
            s.coverageUncertain.toString(),
            snapshot.snapshotWallClockMillis.toString(),
            snapshot.bootId ?: NULL_SENTINEL,
        )
        return fields.joinToString(FIELD_SEPARATOR)
    }

    internal fun decode(raw: String): ScreenTimeSnapshot? =
        when {
            raw.startsWith("$VERSION_3$FIELD_SEPARATOR") -> decodeV3(raw)
            raw.startsWith("$VERSION_2$FIELD_SEPARATOR") -> decodeV2(raw)
            else -> decodeV1(raw)
        }

    private fun decodeV3(raw: String): ScreenTimeSnapshot? {
        val parts = raw.split(FIELD_SEPARATOR, limit = V3_FIELD_COUNT)
        if (parts.size != V3_FIELD_COUNT || parts[0] != VERSION_3) return null
        return try {
            val coverageUncertain = when (parts[17]) {
                "true" -> true
                "false" -> false
                else -> return null
            }
            val state = ScreenTimeState(
                mode = ScreenTimeMode.valueOf(parts[1]),
                activeElapsedNanos = parts[2].toLong(),
                breakElapsedNanos = parts[3].toLong(),
                pauseElapsedNanos = parts[4].toLong(),
                dhikrInteractionCount = parts[5].toInt(),
                completedBreakCount = parts[6].toInt(),
                overriddenBreakCount = parts[7].toInt(),
                lastTickMonotonicNanos = parts[8].toLong(),
                preEmergencyMode = parts[9].takeIf { it != NULL_SENTINEL }?.let { ScreenTimeMode.valueOf(it) },
                preEmergencyActiveElapsedNanos = parts[10].toLong(),
                preEmergencyBreakElapsedNanos = parts[11].toLong(),
                preEmergencyPauseElapsedNanos = parts[12].toLong(),
                preCommunicationMode = parts[13].takeIf { it != NULL_SENTINEL }?.let { ScreenTimeMode.valueOf(it) },
                preCommunicationActiveElapsedNanos = parts[14].toLong(),
                preCommunicationBreakElapsedNanos = parts[15].toLong(),
                preCommunicationPauseElapsedNanos = parts[16].toLong(),
                coverageUncertain = coverageUncertain,
            )
            requireValidPersistedState(state)
            ScreenTimeSnapshot(
                state = state,
                snapshotWallClockMillis = parts[18].toLong(),
                bootId = parts[19].takeIf { it != NULL_SENTINEL },
            )
        } catch (_: IllegalArgumentException) {
            null
        }
    }

    private fun decodeV1(raw: String): ScreenTimeSnapshot? {
        val parts = raw.split(FIELD_SEPARATOR, limit = V1_FIELD_COUNT)
        if (parts.size != V1_FIELD_COUNT) return null
        return try {
            val mode = ScreenTimeMode.valueOf(parts[0])
            val activeElapsed = parts[1].toLong()
            val breakElapsed = parts[2].toLong()
            val pauseElapsed = parts[3].toLong()
            val state = ScreenTimeState(
                mode = mode,
                activeElapsedNanos = activeElapsed,
                breakElapsedNanos = breakElapsed,
                pauseElapsedNanos = pauseElapsed,
                dhikrInteractionCount = parts[4].toInt(),
                completedBreakCount = parts[5].toInt(),
                overriddenBreakCount = parts[6].toInt(),
                lastTickMonotonicNanos = parts[7].toLong(),
                preEmergencyMode = parts[8].takeIf { it != NULL_SENTINEL }?.let { ScreenTimeMode.valueOf(it) },
                preEmergencyActiveElapsedNanos = parts[9].toLong(),
                preEmergencyBreakElapsedNanos = parts[10].toLong(),
                preEmergencyPauseElapsedNanos = parts[11].toLong(),
                // V1 already persisted the current active/break/pause counters but omitted the
                // communication exception's prior mode and copies. Restore those copies from
                // the preserved counters. A positive break/pause cursor proves its mode; at an
                // exact break boundary the unchanged active counter reaches its configured
                // threshold and the next engine tick enters BREAK_SHIELD before crediting time.
                preCommunicationMode = legacyCommunicationMode(mode, breakElapsed, pauseElapsed),
                preCommunicationActiveElapsedNanos = if (mode == ScreenTimeMode.COMMUNICATION_EXCEPTION) activeElapsed else 0L,
                preCommunicationBreakElapsedNanos = if (mode == ScreenTimeMode.COMMUNICATION_EXCEPTION) breakElapsed else 0L,
                preCommunicationPauseElapsedNanos = if (mode == ScreenTimeMode.COMMUNICATION_EXCEPTION) pauseElapsed else 0L,
            )
            requireValidPersistedState(state)
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

    private fun decodeV2(raw: String): ScreenTimeSnapshot? {
        val parts = raw.split(FIELD_SEPARATOR, limit = V2_FIELD_COUNT)
        if (parts.size != V2_FIELD_COUNT || parts[0] != VERSION_2) return null
        return try {
            val state = ScreenTimeState(
                mode = ScreenTimeMode.valueOf(parts[1]),
                activeElapsedNanos = parts[2].toLong(),
                breakElapsedNanos = parts[3].toLong(),
                pauseElapsedNanos = parts[4].toLong(),
                dhikrInteractionCount = parts[5].toInt(),
                completedBreakCount = parts[6].toInt(),
                overriddenBreakCount = parts[7].toInt(),
                lastTickMonotonicNanos = parts[8].toLong(),
                preEmergencyMode = parts[9].takeIf { it != NULL_SENTINEL }?.let { ScreenTimeMode.valueOf(it) },
                preEmergencyActiveElapsedNanos = parts[10].toLong(),
                preEmergencyBreakElapsedNanos = parts[11].toLong(),
                preEmergencyPauseElapsedNanos = parts[12].toLong(),
                preCommunicationMode = parts[13].takeIf { it != NULL_SENTINEL }?.let { ScreenTimeMode.valueOf(it) },
                preCommunicationActiveElapsedNanos = parts[14].toLong(),
                preCommunicationBreakElapsedNanos = parts[15].toLong(),
                preCommunicationPauseElapsedNanos = parts[16].toLong(),
            )
            requireValidPersistedState(state)
            ScreenTimeSnapshot(
                state = state,
                snapshotWallClockMillis = parts[17].toLong(),
                bootId = parts[18].takeIf { it != NULL_SENTINEL },
            )
        } catch (_: IllegalArgumentException) {
            null
        }
    }

    /**
     * Persisted elapsed time and counters are monotonic quantities. A negative corrupt value
     * can extend a screen-time allowance (for example, by making active time appear to be
     * further from its threshold), so reject the whole snapshot and let restoration fail safe.
     * Wall-clock milliseconds are intentionally excluded: they are advisory and may be before
     * the Unix epoch on a valid device configuration.
     */
    private fun requireValidPersistedState(state: ScreenTimeState) {
        require(
            listOf(
                state.activeElapsedNanos,
                state.breakElapsedNanos,
                state.pauseElapsedNanos,
                state.dhikrInteractionCount.toLong(),
                state.completedBreakCount.toLong(),
                state.overriddenBreakCount.toLong(),
                state.lastTickMonotonicNanos,
                state.preEmergencyActiveElapsedNanos,
                state.preEmergencyBreakElapsedNanos,
                state.preEmergencyPauseElapsedNanos,
                state.preCommunicationActiveElapsedNanos,
                state.preCommunicationBreakElapsedNanos,
                state.preCommunicationPauseElapsedNanos,
            ).all { it >= 0L },
        ) { "persisted Screen Time state contains a negative monotonic value" }
    }

    private fun legacyCommunicationMode(
        mode: ScreenTimeMode,
        breakElapsedNanos: Long,
        pauseElapsedNanos: Long,
    ): ScreenTimeMode? = if (mode != ScreenTimeMode.COMMUNICATION_EXCEPTION) {
        null
    } else when {
        breakElapsedNanos > 0L -> ScreenTimeMode.BREAK_SHIELD
        pauseElapsedNanos > 0L -> ScreenTimeMode.PAUSED
        else -> ScreenTimeMode.ACTIVE
    }

    private companion object {
        const val KEY = "screen_time_snapshot_v1"
        const val FIELD_SEPARATOR = "|"
        const val VERSION_2 = "v2"
        const val VERSION_3 = "v3"
        const val V1_FIELD_COUNT = 14
        const val V2_FIELD_COUNT = 19
        const val V3_FIELD_COUNT = 20
        const val NULL_SENTINEL = "NULL"
    }
}
