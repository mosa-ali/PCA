package org.pca.app.feature.screentime.persistence

import org.pca.app.feature.screentime.engine.ScreenTimeState

/**
 * Durable snapshot of the engine state. [snapshotWallClockMillis] and [bootId] are advisory
 * only — used to *detect* a reboot, never to compute elapsed durations.
 *
 * [bootId] should be a value that is stable across process restarts but changes across a
 * device reboot (e.g. Android's `Settings.Global.BOOT_COUNT` or a random id written once per
 * boot). It is optional: a caller that cannot source one can pass `null` and rely on
 * [ScreenTimeRestorer.restore]'s conservative fallback.
 */
data class ScreenTimeSnapshot(
    val state: ScreenTimeState,
    val snapshotWallClockMillis: Long,
    val bootId: String?,
)

interface ScreenTimeSnapshotStore {
    fun save(snapshot: ScreenTimeSnapshot)
    fun load(): ScreenTimeSnapshot?
}

/** In-memory reference implementation, useful for tests and as a default before a durable
 * (e.g. DataStore-backed) implementation is wired in by the coordinator. */
class InMemoryScreenTimeSnapshotStore : ScreenTimeSnapshotStore {
    private var current: ScreenTimeSnapshot? = null

    override fun save(snapshot: ScreenTimeSnapshot) {
        current = snapshot
    }

    override fun load(): ScreenTimeSnapshot? = current
}
