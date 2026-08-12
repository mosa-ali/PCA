package org.pca.app.feature.screentime.engine

import org.junit.Assert.assertEquals
import org.junit.Test
import kotlin.time.Duration.Companion.minutes
import kotlin.time.Duration.Companion.seconds

/**
 * PCA-RUNTIME-1 (owner decision, supersedes FINDING-001): accumulated active-use debt
 * ([ScreenTimeState.activeElapsedNanos]) is preserved across any pause shorter than a full,
 * CONTINUOUS [ScreenTimeConfig.recoveryThresholdNanos] (30 minutes, same value as
 * [ScreenTimeConfig.breakDuration]). Only a genuine, uninterrupted 30-minute rest clears the
 * debt. This closes the prior defect where a 5-minute pause reset the streak, letting a child
 * bank a fresh 60-minute cycle by pausing briefly just short of the threshold.
 */
class MeaningfulPauseTest {

    private val config = ScreenTimeConfig(activeThreshold = 60.minutes, breakDuration = 30.minutes)

    private fun tick(state: ScreenTimeState, nowNanos: Long): ScreenTimeState =
        ScreenTimeEngine.reduce(state, ScreenTimeEvent.Tick(nowNanos), config)

    private fun pause(state: ScreenTimeState, nowNanos: Long): ScreenTimeState =
        ScreenTimeEngine.reduce(state, ScreenTimeEvent.Pause(nowNanos), config)

    private fun resume(state: ScreenTimeState, nowNanos: Long): ScreenTimeState =
        ScreenTimeEngine.reduce(state, ScreenTimeEvent.Resume(nowNanos), config)

    // 59m30s use + 5m pause + 30s use => BREAK_SHIELD
    @Test
    fun `59m30s use, 5m pause, 30s use reaches BREAK_SHIELD`() {
        var state = tick(ScreenTimeState.initial(0L), 59.minutes.inWholeNanoseconds + 30.seconds.inWholeNanoseconds)
        var now = 59.minutes.inWholeNanoseconds + 30.seconds.inWholeNanoseconds
        state = pause(state, now)
        now += 5.minutes.inWholeNanoseconds
        state = tick(state, now)
        assertEquals(59.minutes.inWholeNanoseconds + 30.seconds.inWholeNanoseconds, state.activeElapsedNanos)
        state = resume(state, now)
        now += 30.seconds.inWholeNanoseconds
        state = tick(state, now)
        assertEquals(ScreenTimeMode.BREAK_SHIELD, state.mode)
    }

    // 55m use + 5m pause + 5m use => BREAK_SHIELD
    @Test
    fun `55m use, 5m pause, 5m use reaches BREAK_SHIELD`() {
        var state = tick(ScreenTimeState.initial(0L), 55.minutes.inWholeNanoseconds)
        var now = 55.minutes.inWholeNanoseconds
        state = pause(state, now)
        now += 5.minutes.inWholeNanoseconds
        state = tick(state, now)
        state = resume(state, now)
        now += 5.minutes.inWholeNanoseconds
        state = tick(state, now)
        assertEquals(ScreenTimeMode.BREAK_SHIELD, state.mode)
    }

    // 55m use + 20m pause + 5m use => BREAK_SHIELD
    @Test
    fun `55m use, 20m pause, 5m use reaches BREAK_SHIELD`() {
        var state = tick(ScreenTimeState.initial(0L), 55.minutes.inWholeNanoseconds)
        var now = 55.minutes.inWholeNanoseconds
        state = pause(state, now)
        now += 20.minutes.inWholeNanoseconds
        state = tick(state, now)
        assertEquals(55.minutes.inWholeNanoseconds, state.activeElapsedNanos)
        state = resume(state, now)
        now += 5.minutes.inWholeNanoseconds
        state = tick(state, now)
        assertEquals(ScreenTimeMode.BREAK_SHIELD, state.mode)
    }

    // 55m use + 29m59s pause + 5m use => BREAK_SHIELD (just under the recovery threshold)
    @Test
    fun `55m use, 29m59s pause, 5m use reaches BREAK_SHIELD`() {
        var state = tick(ScreenTimeState.initial(0L), 55.minutes.inWholeNanoseconds)
        var now = 55.minutes.inWholeNanoseconds
        state = pause(state, now)
        now += 29.minutes.inWholeNanoseconds + 59.seconds.inWholeNanoseconds
        state = tick(state, now)
        assertEquals(55.minutes.inWholeNanoseconds, state.activeElapsedNanos)
        state = resume(state, now)
        now += 5.minutes.inWholeNanoseconds
        state = tick(state, now)
        assertEquals(ScreenTimeMode.BREAK_SHIELD, state.mode)
    }

    // 55m use + 30m continuous recovery + resume => new cycle from zero
    @Test
    fun `55m use plus a full 30m continuous recovery resets the cycle to zero`() {
        var state = tick(ScreenTimeState.initial(0L), 55.minutes.inWholeNanoseconds)
        var now = 55.minutes.inWholeNanoseconds
        state = pause(state, now)
        now += 30.minutes.inWholeNanoseconds
        state = tick(state, now)
        assertEquals(0L, state.activeElapsedNanos)
        state = resume(state, now)
        assertEquals(ScreenTimeMode.ACTIVE, state.mode)
        assertEquals(0L, state.activeElapsedNanos)

        // A fresh 60-minute streak is required from here.
        state = tick(state, now + 59.minutes.inWholeNanoseconds)
        assertEquals(ScreenTimeMode.ACTIVE, state.mode)
        state = tick(state, now + 60.minutes.inWholeNanoseconds)
        assertEquals(ScreenTimeMode.BREAK_SHIELD, state.mode)
    }

    // 10m pause + resume + 10m pause + resume + 10m pause => NOT a full recovery reset
    @Test
    fun `three separate 10m pauses never accumulate into one 30m recovery`() {
        var state = tick(ScreenTimeState.initial(0L), 55.minutes.inWholeNanoseconds)
        var now = 55.minutes.inWholeNanoseconds

        repeat(3) {
            state = pause(state, now)
            now += 10.minutes.inWholeNanoseconds
            state = tick(state, now)
            state = resume(state, now)
        }

        // Active-use debt must have survived all three pauses untouched.
        assertEquals(55.minutes.inWholeNanoseconds, state.activeElapsedNanos)

        // Only 5 more minutes of qualifying use should be needed to hit BREAK_SHIELD.
        state = tick(state, now + 5.minutes.inWholeNanoseconds)
        assertEquals(ScreenTimeMode.BREAK_SHIELD, state.mode)
    }

    // A pause shorter than the recovery threshold preserves accumulated debt on resume,
    // and the very next qualifying activity continues the pre-existing streak rather than
    // restarting it.
    @Test
    fun `resuming before the recovery threshold continues the streak rather than restarting it`() {
        var state = tick(ScreenTimeState.initial(0L), 15.minutes.inWholeNanoseconds)
        state = pause(state, 15.minutes.inWholeNanoseconds)
        val shortPauseEnd = 15.minutes.inWholeNanoseconds + 1.minutes.inWholeNanoseconds
        state = tick(state, shortPauseEnd)
        state = resume(state, shortPauseEnd)

        assertEquals(15.minutes.inWholeNanoseconds, state.activeElapsedNanos)

        // Only 45 more minutes of activity should be needed to reach the 60-minute threshold.
        state = tick(state, shortPauseEnd + 44.minutes.inWholeNanoseconds + 59.seconds.inWholeNanoseconds)
        assertEquals(ScreenTimeMode.ACTIVE, state.mode)

        state = tick(state, shortPauseEnd + 45.minutes.inWholeNanoseconds)
        assertEquals(ScreenTimeMode.BREAK_SHIELD, state.mode)
    }

    @Test
    fun `recovery progress is tracked purely on the monotonic clock, independent of wall time`() {
        // The engine's Pause/Resume/Tick events only ever take monotonic nanos; there is no
        // wall-clock parameter anywhere in this path, so it is structurally impossible for
        // wall-clock changes to influence recovery progress. This test simply documents/pins
        // boundary behaviour is identical regardless of how large the monotonic timestamps are
        // (i.e. not anchored to any particular epoch).
        val hugeOffset = 10_000.minutes.inWholeNanoseconds
        var state = ScreenTimeState.initial(hugeOffset)
        state = tick(state, hugeOffset + 55.minutes.inWholeNanoseconds)
        state = pause(state, hugeOffset + 55.minutes.inWholeNanoseconds)
        state = tick(state, hugeOffset + 55.minutes.inWholeNanoseconds + config.recoveryThresholdNanos)

        assertEquals(0L, state.activeElapsedNanos)
    }
}
