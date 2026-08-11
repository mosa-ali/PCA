package org.pca.app.feature.screentime.persistence

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.pca.app.feature.screentime.engine.ScreenTimeMode
import org.pca.app.feature.screentime.engine.ScreenTimeState
import org.pca.app.foundation.InMemoryPersistentStateStore

class PersistentScreenTimeSnapshotStoreTest {

    @Test
    fun `round-trips a snapshot with no pre-emergency state and a bootId`() {
        val store = PersistentScreenTimeSnapshotStore(InMemoryPersistentStateStore())
        val snapshot = ScreenTimeSnapshot(
            state = ScreenTimeState.initial(nowNanos = 42L),
            snapshotWallClockMillis = 1_700_000_000_000L,
            bootId = "boot-abc-123",
        )

        store.save(snapshot)

        assertEquals(snapshot, store.load())
    }

    @Test
    fun `round-trips a snapshot with pre-emergency state and a null bootId`() {
        val store = PersistentScreenTimeSnapshotStore(InMemoryPersistentStateStore())
        val snapshot = ScreenTimeSnapshot(
            state = ScreenTimeState(
                mode = ScreenTimeMode.EMERGENCY_EXCEPTION,
                activeElapsedNanos = 10L,
                breakElapsedNanos = 20L,
                pauseElapsedNanos = 0L,
                dhikrInteractionCount = 3,
                completedBreakCount = 1,
                overriddenBreakCount = 2,
                lastTickMonotonicNanos = 999L,
                preEmergencyMode = ScreenTimeMode.BREAK_SHIELD,
                preEmergencyActiveElapsedNanos = 5L,
                preEmergencyBreakElapsedNanos = 6L,
                preEmergencyPauseElapsedNanos = 7L,
            ),
            snapshotWallClockMillis = 1_700_000_000_000L,
            bootId = null,
        )

        store.save(snapshot)

        assertEquals(snapshot, store.load())
    }

    @Test
    fun `a bootId that itself contains the field separator round-trips intact`() {
        val store = PersistentScreenTimeSnapshotStore(InMemoryPersistentStateStore())
        val snapshot = ScreenTimeSnapshot(
            state = ScreenTimeState.initial(nowNanos = 0L),
            snapshotWallClockMillis = 0L,
            bootId = "weird|boot|id|with|pipes",
        )

        store.save(snapshot)

        assertEquals(snapshot, store.load())
    }

    @Test
    fun `returns null when nothing has been saved yet`() {
        val store = PersistentScreenTimeSnapshotStore(InMemoryPersistentStateStore())
        assertNull(store.load())
    }

    @Test
    fun `decode fails safe to null on the wrong field count instead of throwing`() {
        val underlying = InMemoryPersistentStateStore()
        underlying.putString("screen_time_snapshot_v1", "not|even|close|to|a|valid|encoded|snapshot")
        val store = PersistentScreenTimeSnapshotStore(underlying)

        assertNull(store.load())
    }

    @Test
    fun `decode fails safe to null on an unrecognized enum name instead of throwing`() {
        val underlying = InMemoryPersistentStateStore()
        val validEncoding = PersistentScreenTimeSnapshotStore(underlying).encode(
            ScreenTimeSnapshot(ScreenTimeState.initial(nowNanos = 0L), 0L, null),
        )
        val corrupted = validEncoding.replaceFirst("ACTIVE", "SOME_FUTURE_MODE_THIS_BUILD_DOESNT_KNOW")
        underlying.putString("screen_time_snapshot_v1", corrupted)
        val store = PersistentScreenTimeSnapshotStore(underlying)

        assertNull(store.load())
    }
}
