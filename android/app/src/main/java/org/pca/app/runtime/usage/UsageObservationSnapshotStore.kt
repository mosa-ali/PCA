package org.pca.app.runtime.usage

import org.pca.app.foundation.PersistentStateStore

/**
 * Durable snapshot of [UsageSessionEngineState], the restart-safety counterpart to
 * `ScreenTimeSnapshot` (`feature/screentime/persistence/ScreenTimeSnapshot.kt`). [bootId] is used
 * the same way: stable across a process restart, different across a device reboot, so
 * [UsageObservationRestorer] can tell the two apart.
 */
data class UsageObservationSnapshot(
    val engineState: UsageSessionEngineState,
    val bootId: String?,
)

interface UsageObservationSnapshotStore {
    fun save(snapshot: UsageObservationSnapshot)
    fun load(): UsageObservationSnapshot?
}

/** In-memory reference implementation -- tests and any caller before a durable store is wired in. */
class InMemoryUsageObservationSnapshotStore : UsageObservationSnapshotStore {
    private var current: UsageObservationSnapshot? = null

    override fun save(snapshot: UsageObservationSnapshot) {
        current = snapshot
    }

    override fun load(): UsageObservationSnapshot? = current
}

/**
 * Coordinator integration adapter: backs this port with the same generic [PersistentStateStore]
 * `PersistentScreenTimeSnapshotStore` uses, so process-restart survivability for usage-session
 * tracking gets the same OS-backed at-rest protection (doc 09 Section 7) as every other runtime
 * snapshot in this app -- not a second, weaker persistence mechanism.
 */
class PersistentUsageObservationSnapshotStore(
    private val store: PersistentStateStore,
    private val key: String = KEY,
) : UsageObservationSnapshotStore {

    override fun save(snapshot: UsageObservationSnapshot) {
        store.putString(key, encode(snapshot))
    }

    override fun load(): UsageObservationSnapshot? {
        val raw = store.getString(key) ?: return null
        return decode(raw)
    }

    internal fun encode(snapshot: UsageObservationSnapshot): String {
        val open = snapshot.engineState.openSession
        val fields = listOf(
            open?.appToken ?: NULL_SENTINEL,
            (open?.startedAtElapsedMillis ?: 0L).toString(),
            (open?.startedAtEpochMillis ?: 0L).toString(),
            snapshot.engineState.lastProcessedElapsedMillis.toString(),
            snapshot.bootId ?: NULL_SENTINEL,
        )
        return fields.joinToString(FIELD_SEPARATOR)
    }

    internal fun decode(raw: String): UsageObservationSnapshot? {
        val parts = raw.split(FIELD_SEPARATOR, limit = FIELD_COUNT)
        if (parts.size != FIELD_COUNT) return null
        return try {
            val openToken = parts[0].takeIf { it != NULL_SENTINEL }
            val open = openToken?.let {
                OpenUsageSession(
                    appToken = it,
                    startedAtElapsedMillis = parts[1].toLong(),
                    startedAtEpochMillis = parts[2].toLong(),
                )
            }
            UsageObservationSnapshot(
                engineState = UsageSessionEngineState(
                    openSession = open,
                    lastProcessedElapsedMillis = parts[3].toLong(),
                ),
                bootId = parts[4].takeIf { it != NULL_SENTINEL },
            )
        } catch (_: IllegalArgumentException) {
            // Malformed/corrupt persisted value -- fail safe to "no snapshot" rather than crash;
            // UsageObservationRestorer's own fallback (fresh state) takes over from there.
            null
        }
    }

    private companion object {
        const val KEY = "usage_observation_snapshot_v1"
        const val FIELD_SEPARATOR = "|"
        const val FIELD_COUNT = 5
        const val NULL_SENTINEL = "NULL"
    }
}

/**
 * Restoration contract mirroring `ScreenTimeRestorer`: a process restart within the same boot
 * simply resumes from the persisted [UsageSessionEngineState] (elapsed-realtime keeps counting
 * across process death within one boot, so [UsageSessionEngineState.lastProcessedElapsedMillis]
 * stays comparable). A reboot invalidates the elapsed-realtime cursor entirely (the clock resets
 * to zero) -- rather than fabricate a session end the platform never reported, tracking resets to
 * [UsageSessionEngineState.INITIAL] and observation resumes fresh from the next poll. This is the
 * same "not gapless across reboot" limitation [org.pca.app.platform.UsageObservationSource] itself
 * documents, not a gap introduced by this adapter.
 */
object UsageObservationRestorer {
    fun restore(snapshot: UsageObservationSnapshot?, currentBootId: String?): UsageSessionEngineState {
        if (snapshot == null) return UsageSessionEngineState.INITIAL
        val rebooted = snapshot.bootId != null && currentBootId != null && snapshot.bootId != currentBootId
        return if (rebooted) UsageSessionEngineState.INITIAL else snapshot.engineState
    }
}
