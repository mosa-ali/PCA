package org.pca.app.feature.eyedistance.persistence

import org.pca.app.feature.eyedistance.engine.EyeDistanceState

/**
 * Durable snapshot of the engine state. Mirrors PCA-3's `ScreenTimeSnapshot` contract exactly:
 * [snapshotWallClockMillis] and [bootId] are advisory only, used to *detect* a reboot, never to
 * compute elapsed durations.
 */
data class EyeDistanceSnapshot(
    val state: EyeDistanceState,
    val snapshotWallClockMillis: Long,
    val bootId: String?,
)

interface EyeDistanceSnapshotStore {
    fun save(snapshot: EyeDistanceSnapshot)
    fun load(): EyeDistanceSnapshot?
}

/** In-memory reference implementation, useful for tests and as a default before the durable
 * ([PersistentEyeDistanceSnapshotStore]) implementation is wired in by the coordinator. */
class InMemoryEyeDistanceSnapshotStore : EyeDistanceSnapshotStore {
    private var current: EyeDistanceSnapshot? = null

    override fun save(snapshot: EyeDistanceSnapshot) {
        current = snapshot
    }

    override fun load(): EyeDistanceSnapshot? = current
}
