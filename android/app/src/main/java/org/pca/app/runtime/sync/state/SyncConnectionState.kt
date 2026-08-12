package org.pca.app.runtime.sync.state

enum class SyncConnectionState { OFFLINE, SYNC_PENDING, SYNCING, LIVE, STALE }

data class ComputeConnectionStateInput(
    val isTransportConnected: Boolean,
    val isSyncing: Boolean,
    val hasPendingLocalWork: Boolean,
    val lastSuccessfulSyncAtEpochMillis: Long?,
    val nowEpochMillis: Long,
    val staleThresholdMillis: Long = DEFAULT_STALE_THRESHOLD_MILLIS,
)

const val DEFAULT_STALE_THRESHOLD_MILLIS: Long = 24L * 60 * 60 * 1000

/**
 * Ported from backend/src/familysync/connectionState.ts's
 * `computeSyncConnectionState` (doc 40 Section 2) -- same pure logic,
 * independently implemented here since Kotlin/TypeScript cannot share
 * code across this process boundary. `LIVE` requires BOTH a connected
 * transport AND a recent successful sync; transport connectivity alone
 * (see ConnectivitySource) is never surfaced as `LIVE`.
 */
fun computeSyncConnectionState(input: ComputeConnectionStateInput): SyncConnectionState {
    if (!input.isTransportConnected) return SyncConnectionState.OFFLINE
    if (input.isSyncing) return SyncConnectionState.SYNCING

    val lastSync = input.lastSuccessfulSyncAtEpochMillis
    if (lastSync == null) {
        return if (input.hasPendingLocalWork) SyncConnectionState.SYNC_PENDING else SyncConnectionState.STALE
    }
    val ageMillis = input.nowEpochMillis - lastSync
    if (ageMillis < 0 || ageMillis > input.staleThresholdMillis) return SyncConnectionState.STALE
    return if (input.hasPendingLocalWork) SyncConnectionState.SYNC_PENDING else SyncConnectionState.LIVE
}
