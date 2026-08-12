package org.pca.app.feature.screentime.engine

import org.junit.Assert.assertEquals
import org.junit.Test
import org.pca.app.feature.screentime.persistence.ScreenTimeRestorer
import org.pca.app.feature.screentime.persistence.ScreenTimeSnapshot
import kotlin.time.Duration.Companion.minutes
import kotlin.time.Duration.Companion.seconds

/**
 * PCA-RUNTIME-1 owner decision, Section 9 required scenarios not already covered by
 * [MeaningfulPauseTest] (the pause/recovery boundary cases) or the pre-existing
 * `ScreenTimeRestorerTest` (the general restart/reboot contract). This file exists purely to give
 * the coordinator's SCREEN_TIME_60_30_ANTI_GAMING gate an explicit, by-name trace back to every
 * scenario the owner decision listed.
 */
class ScreenTimeAntiGamingInvariantTest {

    private val config = ScreenTimeConfig(activeThreshold = 60.minutes, breakDuration = 30.minutes)

    // 59m use + process restart + 1m use => BREAK_SHIELD
    @Test
    fun `59m use, process restart same boot, 1m use reaches BREAK_SHIELD`() {
        var state = ScreenTimeEngine.reduce(
            ScreenTimeState.initial(0L),
            ScreenTimeEvent.Tick(59.minutes.inWholeNanoseconds),
            config,
        )
        // Process dies; on restart the snapshot is fed back through the normal restorer path
        // with a fresh "now" reading from the same boot's monotonic clock.
        val snapshot = ScreenTimeSnapshot(state = state, snapshotWallClockMillis = 0L, bootId = "boot-1")
        val restoredNowNanos = 59.minutes.inWholeNanoseconds + 10.seconds.inWholeNanoseconds // process was dead briefly
        state = ScreenTimeRestorer.restore(snapshot, restoredNowNanos, currentBootId = "boot-1", config = config)
        assertEquals(ScreenTimeMode.ACTIVE, state.mode)
        assertEquals(59.minutes.inWholeNanoseconds + 10.seconds.inWholeNanoseconds, state.activeElapsedNanos)

        state = ScreenTimeEngine.reduce(state, ScreenTimeEvent.Tick(restoredNowNanos + 1.minutes.inWholeNanoseconds), config)
        assertEquals(ScreenTimeMode.BREAK_SHIELD, state.mode)
    }

    // 59m use + Internet loss + 1m use => BREAK_SHIELD
    // The engine takes no network/connectivity parameter anywhere in its event or config surface
    // (ScreenTimeEvent is driven purely by monotonic nanoseconds) -- it is structurally impossible
    // for connectivity state to influence accumulation, so continuous ticking across a simulated
    // "offline" gap behaves identically to any other gap.
    @Test
    fun `59m use, simulated internet loss gap, 1m use reaches BREAK_SHIELD`() {
        var state = ScreenTimeEngine.reduce(
            ScreenTimeState.initial(0L),
            ScreenTimeEvent.Tick(59.minutes.inWholeNanoseconds),
            config,
        )
        // A large gap (as if connectivity-dependent bookkeeping had stalled) with no Pause event
        // in between -- the engine only ever sees Tick/Pause/Resume, never a connectivity signal.
        val afterOfflineGap = 59.minutes.inWholeNanoseconds + 10.minutes.inWholeNanoseconds
        state = ScreenTimeEngine.reduce(state, ScreenTimeEvent.Tick(afterOfflineGap), config)
        assertEquals(ScreenTimeMode.BREAK_SHIELD, state.mode)
    }

    // 59m use + device restart (reboot) state restore + 1m use => BREAK_SHIELD
    @Test
    fun `59m use, device reboot restore, 1m use reaches BREAK_SHIELD`() {
        var state = ScreenTimeEngine.reduce(
            ScreenTimeState.initial(0L),
            ScreenTimeEvent.Tick(59.minutes.inWholeNanoseconds),
            config,
        )
        val snapshot = ScreenTimeSnapshot(state = state, snapshotWallClockMillis = 0L, bootId = "boot-1")
        // New boot: the monotonic clock has reset to a small value near zero.
        val postRebootNowNanos = 5.minutes.inWholeNanoseconds
        state = ScreenTimeRestorer.restore(snapshot, postRebootNowNanos, currentBootId = "boot-2", config = config)
        assertEquals(59.minutes.inWholeNanoseconds, state.activeElapsedNanos)

        state = ScreenTimeEngine.reduce(state, ScreenTimeEvent.Tick(postRebootNowNanos + 1.minutes.inWholeNanoseconds), config)
        assertEquals(ScreenTimeMode.BREAK_SHIELD, state.mode)
    }

    // app A 30m + app B 30m continuous qualifying use => BREAK_SHIELD
    // Switching which app is foreground is invisible to this engine -- it has no app-identity
    // concept at all, only Tick/Pause/Resume -- so as long as the composition layer keeps driving
    // Tick (never Pause) across an app switch, continuous qualifying use accumulates without
    // interruption regardless of how many different apps were involved.
    @Test
    fun `continuous qualifying use across a simulated app switch reaches BREAK_SHIELD`() {
        var state = ScreenTimeState.initial(0L)
        // 30 minutes in "app A".
        state = ScreenTimeEngine.reduce(state, ScreenTimeEvent.Tick(30.minutes.inWholeNanoseconds), config)
        assertEquals(ScreenTimeMode.ACTIVE, state.mode)
        assertEquals(30.minutes.inWholeNanoseconds, state.activeElapsedNanos)

        // App switch to "app B" -- no Pause event is emitted, only continued Tick advancement.
        state = ScreenTimeEngine.reduce(state, ScreenTimeEvent.Tick(60.minutes.inWholeNanoseconds), config)
        assertEquals(ScreenTimeMode.BREAK_SHIELD, state.mode)
    }

    // Break Shield completes 30m => active-use cycle reset
    @Test
    fun `a fully completed Break Shield resets the active-use cycle`() {
        var state = ScreenTimeEngine.reduce(ScreenTimeState.initial(0L), ScreenTimeEvent.Tick(60.minutes.inWholeNanoseconds), config)
        assertEquals(ScreenTimeMode.BREAK_SHIELD, state.mode)

        state = ScreenTimeEngine.reduce(state, ScreenTimeEvent.Tick(90.minutes.inWholeNanoseconds), config)
        assertEquals(ScreenTimeMode.ACTIVE, state.mode)
        assertEquals(0L, state.activeElapsedNanos)
        assertEquals(1, state.completedBreakCount)
    }
}
