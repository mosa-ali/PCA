package org.pca.app.feature.screentime.engine

import org.junit.Assert.assertEquals
import org.junit.Test
import kotlin.time.Duration.Companion.minutes
import kotlin.time.Duration.Companion.seconds

/**
 * FINDING-001: a non-qualifying-activity pause shorter than [ScreenTimeConfig.meaningfulPause]
 * preserves the continuous-use streak; a pause at or beyond it resets the streak to zero, and
 * the next qualifying activity starts fresh. Driven purely by the monotonic clock.
 */
class MeaningfulPauseTest {

    private val config = ScreenTimeConfig(activeThreshold = 60.minutes, breakDuration = 30.minutes, meaningfulPause = 5.minutes)

    private fun tick(state: ScreenTimeState, nowNanos: Long): ScreenTimeState =
        ScreenTimeEngine.reduce(state, ScreenTimeEvent.Tick(nowNanos), config)

    private fun pausedAfter15Minutes(): ScreenTimeState {
        var state = tick(ScreenTimeState.initial(0L), 15.minutes.inWholeNanoseconds)
        state = ScreenTimeEngine.reduce(state, ScreenTimeEvent.Pause(15.minutes.inWholeNanoseconds), config)
        return state
    }

    @Test
    fun `just before meaningfulPause the streak is preserved`() {
        val paused = pausedAfter15Minutes()
        val justBefore = 15.minutes.inWholeNanoseconds + config.meaningfulPauseNanos - 1

        val state = tick(paused, justBefore)

        assertEquals(ScreenTimeMode.PAUSED, state.mode)
        assertEquals(15.minutes.inWholeNanoseconds, state.activeElapsedNanos)
        assertEquals(config.meaningfulPauseNanos - 1, state.pauseElapsedNanos)
    }

    @Test
    fun `exactly meaningfulPause resets the streak`() {
        val paused = pausedAfter15Minutes()
        val exact = 15.minutes.inWholeNanoseconds + config.meaningfulPauseNanos

        val state = tick(paused, exact)

        assertEquals(ScreenTimeMode.PAUSED, state.mode)
        assertEquals(0L, state.activeElapsedNanos)
        assertEquals(config.meaningfulPauseNanos, state.pauseElapsedNanos)
    }

    @Test
    fun `one tick beyond meaningfulPause also resets and stays reset`() {
        val paused = pausedAfter15Minutes()
        val beyond = 15.minutes.inWholeNanoseconds + config.meaningfulPauseNanos + 1

        val state = tick(paused, beyond)

        assertEquals(ScreenTimeMode.PAUSED, state.mode)
        assertEquals(0L, state.activeElapsedNanos)
    }

    @Test
    fun `resuming after a meaningful pause starts the next qualifying activity from zero`() {
        var state = pausedAfter15Minutes()
        val afterMeaningfulPause = 15.minutes.inWholeNanoseconds + config.meaningfulPauseNanos + 1.minutes.inWholeNanoseconds
        state = tick(state, afterMeaningfulPause)
        assertEquals(0L, state.activeElapsedNanos)

        state = ScreenTimeEngine.reduce(state, ScreenTimeEvent.Resume(afterMeaningfulPause), config)
        assertEquals(ScreenTimeMode.ACTIVE, state.mode)
        assertEquals(0L, state.activeElapsedNanos)

        // A fresh 60-minute streak is required from here — 59 minutes in must still be ACTIVE.
        state = tick(state, afterMeaningfulPause + 59.minutes.inWholeNanoseconds)
        assertEquals(ScreenTimeMode.ACTIVE, state.mode)

        state = tick(state, afterMeaningfulPause + 60.minutes.inWholeNanoseconds)
        assertEquals(ScreenTimeMode.BREAK_SHIELD, state.mode)
    }

    @Test
    fun `resuming before meaningfulPause continues the streak rather than restarting it`() {
        var state = pausedAfter15Minutes()
        val shortPauseEnd = 15.minutes.inWholeNanoseconds + 1.minutes.inWholeNanoseconds
        state = tick(state, shortPauseEnd)
        state = ScreenTimeEngine.reduce(state, ScreenTimeEvent.Resume(shortPauseEnd), config)

        assertEquals(15.minutes.inWholeNanoseconds, state.activeElapsedNanos)

        // Only 45 more minutes of activity should be needed to reach the 60-minute threshold.
        state = tick(state, shortPauseEnd + 44.minutes.inWholeNanoseconds + 59.seconds.inWholeNanoseconds)
        assertEquals(ScreenTimeMode.ACTIVE, state.mode)

        state = tick(state, shortPauseEnd + 45.minutes.inWholeNanoseconds)
        assertEquals(ScreenTimeMode.BREAK_SHIELD, state.mode)
    }

    @Test
    fun `pause duration is tracked purely on the monotonic clock, independent of wall time`() {
        // The engine's Pause/Resume/Tick events only ever take monotonic nanos; there is no
        // wall-clock parameter anywhere in this path, so it is structurally impossible for
        // wall-clock changes to influence whether a pause is "meaningful". This test simply
        // documents/pins that boundary behaviour is identical regardless of how large the
        // monotonic timestamps are (i.e. not anchored to any particular epoch).
        val hugeOffset = 10_000.minutes.inWholeNanoseconds
        var state = ScreenTimeState.initial(hugeOffset)
        state = tick(state, hugeOffset + 15.minutes.inWholeNanoseconds)
        state = ScreenTimeEngine.reduce(state, ScreenTimeEvent.Pause(hugeOffset + 15.minutes.inWholeNanoseconds), config)
        state = tick(state, hugeOffset + 15.minutes.inWholeNanoseconds + config.meaningfulPauseNanos)

        assertEquals(0L, state.activeElapsedNanos)
    }
}
