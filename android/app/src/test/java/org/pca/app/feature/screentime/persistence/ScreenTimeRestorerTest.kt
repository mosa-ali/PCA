package org.pca.app.feature.screentime.persistence

import org.junit.Assert.assertEquals
import org.junit.Test
import org.pca.app.feature.screentime.engine.ScreenTimeConfig
import org.pca.app.feature.screentime.engine.ScreenTimeEngine
import org.pca.app.feature.screentime.engine.ScreenTimeEvent
import org.pca.app.feature.screentime.engine.ScreenTimeMode
import org.pca.app.feature.screentime.engine.ScreenTimeState
import kotlin.time.Duration.Companion.minutes

class ScreenTimeRestorerTest {

    private val config = ScreenTimeConfig(activeThreshold = 60.minutes, breakDuration = 30.minutes)

    @Test
    fun `process restart within the same boot continues accumulating from the persisted reference`() {
        val stateAtCrash = ScreenTimeEngine.reduce(
            ScreenTimeState.initial(0L),
            ScreenTimeEvent.Tick(20.minutes.inWholeNanoseconds),
            config,
        )
        val snapshot = ScreenTimeSnapshot(state = stateAtCrash, snapshotWallClockMillis = 1_000L, bootId = "boot-1")

        // process was dead for 50 minutes of monotonic time, still the same boot.
        val restored = ScreenTimeRestorer.restoreAfterProcessRestart(
            snapshot,
            nowNanos = 70.minutes.inWholeNanoseconds,
            config = config,
        )

        assertEquals(ScreenTimeMode.BREAK_SHIELD, restored.mode)
        assertEquals(10.minutes.inWholeNanoseconds, restored.breakElapsedNanos)
    }

    @Test
    fun `reboot preserves accumulated progress and mode but re-anchors the monotonic reference`() {
        val stateAtShutdown = ScreenTimeEngine.reduce(
            ScreenTimeState.initial(0L),
            ScreenTimeEvent.Tick(45.minutes.inWholeNanoseconds),
            config,
        )
        val snapshot = ScreenTimeSnapshot(state = stateAtShutdown, snapshotWallClockMillis = 1_000L, bootId = "boot-1")

        // After reboot the OS monotonic clock restarts near zero — old reference is meaningless.
        val nowAfterBoot = 3.minutes.inWholeNanoseconds
        val restored = ScreenTimeRestorer.restoreAfterReboot(snapshot, nowAfterBoot)

        assertEquals(ScreenTimeMode.ACTIVE, restored.mode)
        assertEquals(45.minutes.inWholeNanoseconds, restored.activeElapsedNanos)
        assertEquals(nowAfterBoot, restored.lastTickMonotonicNanos)
    }

    @Test
    fun `a pending break survives a reboot instead of being silently cleared`() {
        val stateInBreak = ScreenTimeEngine.reduce(
            ScreenTimeState.initial(0L),
            ScreenTimeEvent.Tick(70.minutes.inWholeNanoseconds),
            config,
        )
        val snapshot = ScreenTimeSnapshot(state = stateInBreak, snapshotWallClockMillis = 1_000L, bootId = "boot-1")

        val restored = ScreenTimeRestorer.restoreAfterReboot(snapshot, nowNanos = 5.minutes.inWholeNanoseconds)

        assertEquals(ScreenTimeMode.BREAK_SHIELD, restored.mode)
        assertEquals(10.minutes.inWholeNanoseconds, restored.breakElapsedNanos)
    }

    @Test
    fun `restore auto-detects a reboot from a changed bootId`() {
        val stateAtShutdown = ScreenTimeEngine.reduce(
            ScreenTimeState.initial(0L),
            ScreenTimeEvent.Tick(45.minutes.inWholeNanoseconds),
            config,
        )
        val snapshot = ScreenTimeSnapshot(state = stateAtShutdown, snapshotWallClockMillis = 1_000L, bootId = "boot-1")

        val restored = ScreenTimeRestorer.restore(snapshot, nowNanos = 1.minutes.inWholeNanoseconds, currentBootId = "boot-2", config = config)

        assertEquals(45.minutes.inWholeNanoseconds, restored.activeElapsedNanos)
        assertEquals(1.minutes.inWholeNanoseconds, restored.lastTickMonotonicNanos)
    }

    @Test
    fun `restore treats a matching bootId as an ordinary process restart`() {
        val stateAtCrash = ScreenTimeEngine.reduce(
            ScreenTimeState.initial(0L),
            ScreenTimeEvent.Tick(20.minutes.inWholeNanoseconds),
            config,
        )
        val snapshot = ScreenTimeSnapshot(state = stateAtCrash, snapshotWallClockMillis = 1_000L, bootId = "boot-1")

        val restored = ScreenTimeRestorer.restore(snapshot, nowNanos = 70.minutes.inWholeNanoseconds, currentBootId = "boot-1", config = config)

        assertEquals(ScreenTimeMode.BREAK_SHIELD, restored.mode)
        assertEquals(10.minutes.inWholeNanoseconds, restored.breakElapsedNanos)
    }

    @Test
    fun `restore without a bootId on either side falls back conservatively to process-restart handling`() {
        val stateAtCrash = ScreenTimeEngine.reduce(
            ScreenTimeState.initial(0L),
            ScreenTimeEvent.Tick(20.minutes.inWholeNanoseconds),
            config,
        )
        val snapshot = ScreenTimeSnapshot(state = stateAtCrash, snapshotWallClockMillis = 1_000L, bootId = null)

        val restored = ScreenTimeRestorer.restore(snapshot, nowNanos = 70.minutes.inWholeNanoseconds, currentBootId = null, config = config)

        assertEquals(ScreenTimeMode.BREAK_SHIELD, restored.mode)
        assertEquals(10.minutes.inWholeNanoseconds, restored.breakElapsedNanos)
    }

    @Test
    fun `in-memory snapshot store round-trips a snapshot`() {
        val store = InMemoryScreenTimeSnapshotStore()
        assertEquals(null, store.load())

        val state = ScreenTimeState.initial(0L)
        val snapshot = ScreenTimeSnapshot(state = state, snapshotWallClockMillis = 42L, bootId = "boot-1")
        store.save(snapshot)

        assertEquals(snapshot, store.load())
    }
}
