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
    fun `process restart preserves only the checkpoint and does not count time while process was absent`() {
        val stateAtCrash = ScreenTimeEngine.reduce(
            ScreenTimeState.initial(0L),
            ScreenTimeEvent.Tick(20.minutes.inWholeNanoseconds),
            config,
        )
        val snapshot = ScreenTimeSnapshot(state = stateAtCrash, snapshotWallClockMillis = 1_000L, bootId = "boot-1")

        // Process was dead for 50 minutes of monotonic time, still the same boot. The clock can
        // measure that gap but it cannot establish qualifying use or a completed break.
        val restored = ScreenTimeRestorer.restoreAfterProcessRestart(
            snapshot,
            nowNanos = 70.minutes.inWholeNanoseconds,
            config = config,
        )

        assertEquals(ScreenTimeMode.ACTIVE, restored.mode)
        assertEquals(20.minutes.inWholeNanoseconds, restored.activeElapsedNanos)
        assertEquals(0L, restored.breakElapsedNanos)
        assertEquals(70.minutes.inWholeNanoseconds, restored.lastTickMonotonicNanos)
        assertEquals(true, restored.coverageUncertain)
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
        assertEquals(true, restored.coverageUncertain)
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
        assertEquals(true, restored.coverageUncertain)
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
    fun `restore with a matching bootId still preserves only the checkpoint`() {
        val stateAtCrash = ScreenTimeEngine.reduce(
            ScreenTimeState.initial(0L),
            ScreenTimeEvent.Tick(20.minutes.inWholeNanoseconds),
            config,
        )
        val snapshot = ScreenTimeSnapshot(state = stateAtCrash, snapshotWallClockMillis = 1_000L, bootId = "boot-1")

        val restored = ScreenTimeRestorer.restore(snapshot, nowNanos = 70.minutes.inWholeNanoseconds, currentBootId = "boot-1", config = config)

        assertEquals(ScreenTimeMode.ACTIVE, restored.mode)
        assertEquals(20.minutes.inWholeNanoseconds, restored.activeElapsedNanos)
        assertEquals(0L, restored.breakElapsedNanos)
        assertEquals(true, restored.coverageUncertain)
    }

    @Test
    fun `same boot restart cannot complete a pending break from unobserved downtime`() {
        val stateInBreak = ScreenTimeEngine.reduce(
            ScreenTimeState.initial(0L),
            ScreenTimeEvent.Tick(80.minutes.inWholeNanoseconds),
            config,
        )
        val snapshot = ScreenTimeSnapshot(stateInBreak, snapshotWallClockMillis = 1_000L, bootId = "boot-1")

        val restored = ScreenTimeRestorer.restore(snapshot, nowNanos = 200.minutes.inWholeNanoseconds, currentBootId = "boot-1", config = config)

        assertEquals(ScreenTimeMode.BREAK_SHIELD, restored.mode)
        assertEquals(20.minutes.inWholeNanoseconds, restored.breakElapsedNanos)
        assertEquals(true, restored.coverageUncertain)

        val afterObservedBreak = ScreenTimeEngine.reduce(
            restored,
            ScreenTimeEvent.Tick(210.minutes.inWholeNanoseconds),
            config,
        )
        assertEquals(ScreenTimeMode.ACTIVE, afterObservedBreak.mode)
        assertEquals(false, afterObservedBreak.coverageUncertain)
    }

    @Test
    fun `restart clears only unverified paused duration and requires a fresh continuous recovery`() {
        val pausedState = ScreenTimeState.initial(0L).copy(
            mode = ScreenTimeMode.PAUSED,
            activeElapsedNanos = 59.minutes.inWholeNanoseconds,
            pauseElapsedNanos = 29.minutes.inWholeNanoseconds,
            lastTickMonotonicNanos = 30.minutes.inWholeNanoseconds,
        )
        val snapshot = ScreenTimeSnapshot(pausedState, snapshotWallClockMillis = 1_000L, bootId = "boot-1")

        val restored = ScreenTimeRestorer.restore(snapshot, nowNanos = 120.minutes.inWholeNanoseconds, currentBootId = "boot-1", config = config)
        assertEquals(ScreenTimeMode.PAUSED, restored.mode)
        assertEquals(59.minutes.inWholeNanoseconds, restored.activeElapsedNanos)
        assertEquals(0L, restored.pauseElapsedNanos)
        assertEquals(true, restored.coverageUncertain)

        val afterObservedRest = ScreenTimeEngine.reduce(
            restored,
            ScreenTimeEvent.Tick(150.minutes.inWholeNanoseconds),
            config,
        )
        assertEquals(0L, afterObservedRest.activeElapsedNanos)
        assertEquals(false, afterObservedRest.coverageUncertain)
    }

    @Test
    fun `emergency exception recovery resets paused time and preserves active and break checkpoints`() {
        val active = ScreenTimeEngine.reduce(
            ScreenTimeState.initial(0L),
            ScreenTimeEvent.Tick(40.minutes.inWholeNanoseconds),
            config,
        )
        val paused = ScreenTimeEngine.reduce(
            active,
            ScreenTimeEvent.Pause(40.minutes.inWholeNanoseconds),
            config,
        )
        val pauseProgress = ScreenTimeEngine.reduce(
            paused,
            ScreenTimeEvent.Tick(55.minutes.inWholeNanoseconds),
            config,
        )
        val duringEmergency = ScreenTimeEngine.reduce(
            pauseProgress,
            ScreenTimeEvent.EmergencyExceptionActivate(55.minutes.inWholeNanoseconds),
            config,
        )
        assertEquals(ScreenTimeMode.PAUSED, duringEmergency.preEmergencyMode)

        val restored = ScreenTimeRestorer.restore(
            ScreenTimeSnapshot(duringEmergency, snapshotWallClockMillis = 1_000L, bootId = "boot-1"),
            nowNanos = 90.minutes.inWholeNanoseconds,
            currentBootId = "boot-1",
            config = config,
        )
        assertEquals(ScreenTimeMode.EMERGENCY_EXCEPTION, restored.mode)
        assertEquals(ScreenTimeMode.PAUSED, restored.preEmergencyMode)
        assertEquals(0L, restored.preEmergencyPauseElapsedNanos)
        val afterEmergency = ScreenTimeEngine.reduce(
            restored,
            ScreenTimeEvent.EmergencyExceptionDeactivate(restored.lastTickMonotonicNanos),
            config,
        )

        assertEquals(ScreenTimeMode.PAUSED, afterEmergency.mode)
        assertEquals(40.minutes.inWholeNanoseconds, afterEmergency.activeElapsedNanos)
        assertEquals(0L, afterEmergency.breakElapsedNanos)
        assertEquals(0L, afterEmergency.pauseElapsedNanos)
        assertEquals(true, afterEmergency.coverageUncertain)
    }

    @Test
    fun `same boot future monotonic reference preserves state and reanchors to now`() {
        val futureTick = ScreenTimeState.initial(Long.MAX_VALUE).copy(
            mode = ScreenTimeMode.BREAK_SHIELD,
            activeElapsedNanos = 60.minutes.inWholeNanoseconds,
            breakElapsedNanos = 7.minutes.inWholeNanoseconds,
            dhikrInteractionCount = 3,
            completedBreakCount = 2,
            overriddenBreakCount = 1,
        )
        val snapshot = ScreenTimeSnapshot(state = futureTick, snapshotWallClockMillis = 1_000L, bootId = "boot-1")
        val now = 5.minutes.inWholeNanoseconds

        val restored = ScreenTimeRestorer.restore(snapshot, nowNanos = now, currentBootId = "boot-1", config = config)

        assertEquals(futureTick.copy(lastTickMonotonicNanos = now, coverageUncertain = true), restored)
        val nextTick = ScreenTimeEngine.reduce(restored, ScreenTimeEvent.Tick(now + 1.minutes.inWholeNanoseconds), config)
        assertEquals(8.minutes.inWholeNanoseconds, nextTick.breakElapsedNanos)
    }

    @Test
    fun `restore without a bootId on either side fails safe to the reboot-conservative path, never process-restart`() {
        // PCA-RUNTIME-2R1: same-boot continuity must be POSITIVELY confirmed. An unavailable
        // bootId on either side is NOT evidence of a same-boot restart -- it must take the same
        // conservative path as a confirmed reboot (accumulated progress preserved exactly, only
        // the monotonic reference re-anchored), never fabricate/discard time across an unverified
        // boot boundary by running it through the engine as if the process merely restarted.
        val stateAtCrash = ScreenTimeEngine.reduce(
            ScreenTimeState.initial(0L),
            ScreenTimeEvent.Tick(20.minutes.inWholeNanoseconds),
            config,
        )
        val snapshot = ScreenTimeSnapshot(state = stateAtCrash, snapshotWallClockMillis = 1_000L, bootId = null)

        val restored = ScreenTimeRestorer.restore(snapshot, nowNanos = 70.minutes.inWholeNanoseconds, currentBootId = null, config = config)

        assertEquals(ScreenTimeMode.ACTIVE, restored.mode)
        assertEquals(20.minutes.inWholeNanoseconds, restored.activeElapsedNanos)
        assertEquals(0L, restored.breakElapsedNanos)
        assertEquals(70.minutes.inWholeNanoseconds, restored.lastTickMonotonicNanos)
        assertEquals(true, restored.coverageUncertain)
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
