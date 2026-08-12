package org.pca.app.runtime.sync

import org.junit.Assert.assertEquals
import org.junit.Test
import org.pca.app.runtime.sync.state.ComputeConnectionStateInput
import org.pca.app.runtime.sync.state.SyncConnectionState
import org.pca.app.runtime.sync.state.computeSyncConnectionState

class SyncConnectionStateCalculatorTest {
    private val now = 1_700_000_000_000L

    @Test
    fun `transport disconnected is always OFFLINE`() {
        val state = computeSyncConnectionState(
            ComputeConnectionStateInput(isTransportConnected = false, isSyncing = true, hasPendingLocalWork = true, lastSuccessfulSyncAtEpochMillis = now, nowEpochMillis = now),
        )
        assertEquals(SyncConnectionState.OFFLINE, state)
    }

    @Test
    fun `connected but never synced is STALE, not LIVE`() {
        val state = computeSyncConnectionState(
            ComputeConnectionStateInput(isTransportConnected = true, isSyncing = false, hasPendingLocalWork = false, lastSuccessfulSyncAtEpochMillis = null, nowEpochMillis = now),
        )
        assertEquals(SyncConnectionState.STALE, state)
    }

    @Test
    fun `recent sync with no pending work is LIVE`() {
        val state = computeSyncConnectionState(
            ComputeConnectionStateInput(isTransportConnected = true, isSyncing = false, hasPendingLocalWork = false, lastSuccessfulSyncAtEpochMillis = now - 1000, nowEpochMillis = now),
        )
        assertEquals(SyncConnectionState.LIVE, state)
    }

    @Test
    fun `recent sync with pending work is SYNC_PENDING`() {
        val state = computeSyncConnectionState(
            ComputeConnectionStateInput(isTransportConnected = true, isSyncing = false, hasPendingLocalWork = true, lastSuccessfulSyncAtEpochMillis = now - 1000, nowEpochMillis = now),
        )
        assertEquals(SyncConnectionState.SYNC_PENDING, state)
    }

    @Test
    fun `a sync older than the stale threshold is STALE`() {
        val state = computeSyncConnectionState(
            ComputeConnectionStateInput(isTransportConnected = true, isSyncing = false, hasPendingLocalWork = false, lastSuccessfulSyncAtEpochMillis = now - 25L * 60 * 60 * 1000, nowEpochMillis = now),
        )
        assertEquals(SyncConnectionState.STALE, state)
    }

    @Test
    fun `actively syncing wins over every other input`() {
        val state = computeSyncConnectionState(
            ComputeConnectionStateInput(isTransportConnected = true, isSyncing = true, hasPendingLocalWork = false, lastSuccessfulSyncAtEpochMillis = now, nowEpochMillis = now),
        )
        assertEquals(SyncConnectionState.SYNCING, state)
    }
}
