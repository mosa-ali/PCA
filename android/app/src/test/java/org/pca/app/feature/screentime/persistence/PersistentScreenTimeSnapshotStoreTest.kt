package org.pca.app.feature.screentime.persistence

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.pca.app.feature.screentime.engine.ScreenTimeMode
import org.pca.app.feature.screentime.engine.ScreenTimeConfig
import org.pca.app.feature.screentime.engine.ScreenTimeEngine
import org.pca.app.feature.screentime.engine.ScreenTimeEvent
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
    fun `communication exception restart preserves prior active paused and break state`() {
        val priorStates = listOf(
            ScreenTimeState.initial(nowNanos = 100L).copy(activeElapsedNanos = 30L),
            ScreenTimeState.initial(nowNanos = 100L).copy(
                mode = ScreenTimeMode.PAUSED,
                activeElapsedNanos = 30L,
                pauseElapsedNanos = 20L,
            ),
            ScreenTimeState.initial(nowNanos = 100L).copy(
                mode = ScreenTimeMode.BREAK_SHIELD,
                activeElapsedNanos = 60L,
                breakElapsedNanos = 20L,
            ),
        )

        for (prior in priorStates) {
            val duringCall = ScreenTimeEngine.reduce(
                prior,
                ScreenTimeEvent.CommunicationExceptionActivate(prior.lastTickMonotonicNanos),
            )
            val persistent = PersistentScreenTimeSnapshotStore(InMemoryPersistentStateStore())
            persistent.save(ScreenTimeSnapshot(duringCall, snapshotWallClockMillis = 1L, bootId = "boot-1"))

            val loaded = persistent.load()!!
            assertEquals("communication exception state should survive persistence", duringCall, loaded.state)
            val afterRestart = ScreenTimeRestorer.restore(
                loaded,
                nowNanos = prior.lastTickMonotonicNanos + 1_000L,
                currentBootId = "boot-1",
            )
            val afterCall = ScreenTimeEngine.reduce(
                afterRestart,
                ScreenTimeEvent.CommunicationExceptionDeactivate(afterRestart.lastTickMonotonicNanos),
            )

            assertEquals(prior.mode, afterCall.mode)
            assertEquals(prior.activeElapsedNanos, afterCall.activeElapsedNanos)
            assertEquals(prior.breakElapsedNanos, afterCall.breakElapsedNanos)
            assertEquals(prior.pauseElapsedNanos, afterCall.pauseElapsedNanos)
        }
    }

    @Test
    fun `legacy v1 normal snapshot remains readable`() {
        val underlying = InMemoryPersistentStateStore()
        val snapshot = ScreenTimeSnapshot(
            state = ScreenTimeState.initial(nowNanos = 42L).copy(activeElapsedNanos = 30L),
            snapshotWallClockMillis = 1_700_000_000_000L,
            bootId = "boot-v1",
        )
        underlying.putString("screen_time_snapshot_v1", encodeV1(snapshot))

        assertEquals(snapshot, PersistentScreenTimeSnapshotStore(underlying).load())
    }

    @Test
    fun `legacy v1 communication exception reconstructs prior mode without dropping counters`() {
        val underlying = InMemoryPersistentStateStore()
        val priorStates = listOf(
            ScreenTimeState.initial(nowNanos = 42L).copy(activeElapsedNanos = 30L),
            ScreenTimeState.initial(nowNanos = 42L).copy(
                mode = ScreenTimeMode.PAUSED,
                activeElapsedNanos = 30L,
                pauseElapsedNanos = 20L,
            ),
            ScreenTimeState.initial(nowNanos = 42L).copy(
                mode = ScreenTimeMode.BREAK_SHIELD,
                activeElapsedNanos = 60L,
                breakElapsedNanos = 20L,
            ),
        )

        for (prior in priorStates) {
            val duringCall = ScreenTimeEngine.reduce(
                prior,
                ScreenTimeEvent.CommunicationExceptionActivate(prior.lastTickMonotonicNanos),
            )
            val legacy = ScreenTimeSnapshot(duringCall, snapshotWallClockMillis = 1L, bootId = "boot-v1")
            underlying.putString("screen_time_snapshot_v1", encodeV1(legacy))

            val loaded = PersistentScreenTimeSnapshotStore(underlying).load()!!
            val afterRestart = ScreenTimeRestorer.restore(
                loaded,
                nowNanos = prior.lastTickMonotonicNanos + 1_000L,
                currentBootId = "boot-v1",
            )
            val afterCall = ScreenTimeEngine.reduce(
                afterRestart,
                ScreenTimeEvent.CommunicationExceptionDeactivate(afterRestart.lastTickMonotonicNanos),
            )

            assertEquals(prior.mode, afterCall.mode)
            assertEquals(prior.activeElapsedNanos, afterCall.activeElapsedNanos)
            assertEquals(prior.breakElapsedNanos, afterCall.breakElapsedNanos)
            assertEquals(prior.pauseElapsedNanos, afterCall.pauseElapsedNanos)
        }
    }

    @Test
    fun `legacy v1 communication exception at active threshold enters break on the next tick`() {
        val underlying = InMemoryPersistentStateStore()
        val prior = ScreenTimeState.initial(nowNanos = 42L).copy(
            activeElapsedNanos = ScreenTimeConfig().activeThresholdNanos,
        )
        val duringCall = ScreenTimeEngine.reduce(
            prior,
            ScreenTimeEvent.CommunicationExceptionActivate(prior.lastTickMonotonicNanos),
        )
        underlying.putString(
            "screen_time_snapshot_v1",
            encodeV1(ScreenTimeSnapshot(duringCall, snapshotWallClockMillis = 1L, bootId = "boot-v1")),
        )

        val loaded = PersistentScreenTimeSnapshotStore(underlying).load()!!
        val afterRestart = ScreenTimeRestorer.restore(
            loaded,
            nowNanos = prior.lastTickMonotonicNanos + 1_000L,
            currentBootId = "boot-v1",
        )
        val afterCall = ScreenTimeEngine.reduce(
            afterRestart,
            ScreenTimeEvent.CommunicationExceptionDeactivate(afterRestart.lastTickMonotonicNanos),
        )
        assertEquals(prior.activeElapsedNanos, afterCall.activeElapsedNanos)
        assertEquals(ScreenTimeMode.ACTIVE, afterCall.mode)

        val nextTick = ScreenTimeEngine.reduce(
            afterCall,
            ScreenTimeEvent.Tick(afterCall.lastTickMonotonicNanos + 1L),
        )

        assertEquals(ScreenTimeMode.BREAK_SHIELD, nextTick.mode)
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

    private fun encodeV1(snapshot: ScreenTimeSnapshot): String {
        val state = snapshot.state
        return listOf(
            state.mode.name,
            state.activeElapsedNanos.toString(),
            state.breakElapsedNanos.toString(),
            state.pauseElapsedNanos.toString(),
            state.dhikrInteractionCount.toString(),
            state.completedBreakCount.toString(),
            state.overriddenBreakCount.toString(),
            state.lastTickMonotonicNanos.toString(),
            state.preEmergencyMode?.name ?: "NULL",
            state.preEmergencyActiveElapsedNanos.toString(),
            state.preEmergencyBreakElapsedNanos.toString(),
            state.preEmergencyPauseElapsedNanos.toString(),
            snapshot.snapshotWallClockMillis.toString(),
            snapshot.bootId ?: "NULL",
        ).joinToString("|")
    }
}
