package org.pca.app.feature.screentime.engine

import org.junit.Assert.assertEquals
import org.junit.Test
import kotlin.time.Duration.Companion.minutes
import kotlin.time.Duration.Companion.seconds

class ScreenTimeEngineTest {

    private val config = ScreenTimeConfig(activeThreshold = 60.minutes, breakDuration = 30.minutes)

    private fun tick(state: ScreenTimeState, nowNanos: Long): ScreenTimeState =
        ScreenTimeEngine.reduce(state, ScreenTimeEvent.Tick(nowNanos), config)

    // ---- boundaries -----------------------------------------------------

    @Test
    fun `just before 60 minutes stays ACTIVE`() {
        val start = ScreenTimeState.initial(nowNanos = 0L)
        val justBefore = 60.minutes.inWholeNanoseconds - 1
        val state = tick(start, justBefore)

        assertEquals(ScreenTimeMode.ACTIVE, state.mode)
        assertEquals(justBefore, state.activeElapsedNanos)
        assertEquals(1L, ScreenTimeEngine.remainingActiveNanos(state, config))
    }

    @Test
    fun `exactly 60 minutes triggers BREAK_SHIELD`() {
        val start = ScreenTimeState.initial(nowNanos = 0L)
        val exact = 60.minutes.inWholeNanoseconds
        val state = tick(start, exact)

        assertEquals(ScreenTimeMode.BREAK_SHIELD, state.mode)
        assertEquals(config.activeThresholdNanos, state.activeElapsedNanos)
        assertEquals(0L, state.breakElapsedNanos)
    }

    @Test
    fun `just before 30-minute break completion stays in BREAK_SHIELD`() {
        var state = tick(ScreenTimeState.initial(0L), 60.minutes.inWholeNanoseconds)
        val justBefore = 60.minutes.inWholeNanoseconds + 30.minutes.inWholeNanoseconds - 1
        state = tick(state, justBefore)

        assertEquals(ScreenTimeMode.BREAK_SHIELD, state.mode)
        assertEquals(30.minutes.inWholeNanoseconds - 1, state.breakElapsedNanos)
        assertEquals(0, state.completedBreakCount)
    }

    @Test
    fun `exact break completion returns to ACTIVE and increments counter`() {
        var state = tick(ScreenTimeState.initial(0L), 60.minutes.inWholeNanoseconds)
        val exactCompletion = 60.minutes.inWholeNanoseconds + 30.minutes.inWholeNanoseconds
        state = tick(state, exactCompletion)

        assertEquals(ScreenTimeMode.ACTIVE, state.mode)
        assertEquals(0L, state.activeElapsedNanos)
        assertEquals(0L, state.breakElapsedNanos)
        assertEquals(1, state.completedBreakCount)
        assertEquals(0, state.dhikrInteractionCount)
    }

    // ---- clock manipulation resistance -----------------------------------

    @Test
    fun `clock backwards never decreases accumulated progress`() {
        val start = ScreenTimeState.initial(0L)
        val advanced = tick(start, 10.minutes.inWholeNanoseconds)
        val wentBackwards = tick(advanced, 5.minutes.inWholeNanoseconds)

        assertEquals(10.minutes.inWholeNanoseconds, wentBackwards.activeElapsedNanos)
        assertEquals(10.minutes.inWholeNanoseconds, wentBackwards.lastTickMonotonicNanos)
    }

    @Test
    fun `clock forwards by a large jump cascades through multiple cycles deterministically`() {
        // 60 active + 30 break + 40 active (new, partial) = 130 minutes in one jump.
        val start = ScreenTimeState.initial(0L)
        val state = tick(start, 130.minutes.inWholeNanoseconds)

        assertEquals(ScreenTimeMode.ACTIVE, state.mode)
        assertEquals(40.minutes.inWholeNanoseconds, state.activeElapsedNanos)
        assertEquals(1, state.completedBreakCount)
    }

    @Test
    fun `a jump spanning many cycles resolves without runaway growth`() {
        val start = ScreenTimeState.initial(0L)
        // 5 full active/break cycles (90 min each) plus 10 minutes into a 6th active period.
        val nowNanos = 5 * 90.minutes.inWholeNanoseconds + 10.minutes.inWholeNanoseconds
        val state = tick(start, nowNanos)

        assertEquals(ScreenTimeMode.ACTIVE, state.mode)
        assertEquals(10.minutes.inWholeNanoseconds, state.activeElapsedNanos)
        assertEquals(5, state.completedBreakCount)
    }

    // ---- offline behaviour / process restart is the same code path ------

    @Test
    fun `offline gap while ACTIVE is accounted for on the next tick`() {
        var state = tick(ScreenTimeState.initial(0L), 20.minutes.inWholeNanoseconds)
        // device offline for 50 minutes; next observed tick is 70 minutes in.
        state = tick(state, 70.minutes.inWholeNanoseconds)

        assertEquals(ScreenTimeMode.BREAK_SHIELD, state.mode)
        assertEquals(10.minutes.inWholeNanoseconds, state.breakElapsedNanos)
    }

    // ---- duplicate events -------------------------------------------------

    @Test
    fun `duplicate tick at the same instant is a no-op`() {
        var state = tick(ScreenTimeState.initial(0L), 20.minutes.inWholeNanoseconds)
        val before = state
        state = tick(state, 20.minutes.inWholeNanoseconds)

        assertEquals(before, state)
    }

    @Test
    fun `replaying an older event after a newer one has already landed changes nothing`() {
        var state = tick(ScreenTimeState.initial(0L), 30.minutes.inWholeNanoseconds)
        val afterNewer = state
        state = tick(state, 10.minutes.inWholeNanoseconds) // stale/duplicate, arrives late

        assertEquals(afterNewer.activeElapsedNanos, state.activeElapsedNanos)
        assertEquals(30.minutes.inWholeNanoseconds, state.lastTickMonotonicNanos)
    }

    // ---- pause / resume ----------------------------------------------------

    @Test
    fun `pause freezes accumulation and resume continues from where it left off`() {
        var state = tick(ScreenTimeState.initial(0L), 15.minutes.inWholeNanoseconds)
        state = ScreenTimeEngine.reduce(state, ScreenTimeEvent.Pause(15.minutes.inWholeNanoseconds), config)
        assertEquals(ScreenTimeMode.PAUSED, state.mode)

        // 100 minutes pass while paused: must not accumulate.
        state = tick(state, 115.minutes.inWholeNanoseconds)
        assertEquals(ScreenTimeMode.PAUSED, state.mode)
        assertEquals(15.minutes.inWholeNanoseconds, state.activeElapsedNanos)

        state = ScreenTimeEngine.reduce(state, ScreenTimeEvent.Resume(115.minutes.inWholeNanoseconds), config)
        assertEquals(ScreenTimeMode.ACTIVE, state.mode)

        state = tick(state, 115.minutes.inWholeNanoseconds + 44.minutes.inWholeNanoseconds + 59.seconds.inWholeNanoseconds)
        assertEquals(ScreenTimeMode.ACTIVE, state.mode)

        state = tick(state, 115.minutes.inWholeNanoseconds + 45.minutes.inWholeNanoseconds)
        assertEquals(ScreenTimeMode.BREAK_SHIELD, state.mode)
    }

    // ---- parent override ----------------------------------------------------

    @Test
    fun `parent override skips the remainder of a break immediately`() {
        var state = tick(ScreenTimeState.initial(0L), 60.minutes.inWholeNanoseconds)
        assertEquals(ScreenTimeMode.BREAK_SHIELD, state.mode)

        state = ScreenTimeEngine.reduce(
            state,
            ScreenTimeEvent.ParentOverrideSkipBreak(65.minutes.inWholeNanoseconds),
            config,
        )

        assertEquals(ScreenTimeMode.ACTIVE, state.mode)
        assertEquals(0L, state.activeElapsedNanos)
        assertEquals(1, state.overriddenBreakCount)
        assertEquals(0, state.completedBreakCount)
    }

    @Test
    fun `parent override grants extra active time before the break is forced`() {
        var state = tick(ScreenTimeState.initial(0L), 55.minutes.inWholeNanoseconds)
        state = ScreenTimeEngine.reduce(
            state,
            ScreenTimeEvent.ParentOverrideGrantTime(55.minutes.inWholeNanoseconds, 15.minutes),
            config,
        )
        // 5 minutes of headroom left before the grant, +15 granted = 20 minutes of new headroom.
        assertEquals(ScreenTimeMode.ACTIVE, state.mode)
        assertEquals(20.minutes.inWholeNanoseconds, ScreenTimeEngine.remainingActiveNanos(state, config))

        state = tick(state, 55.minutes.inWholeNanoseconds + 19.minutes.inWholeNanoseconds)
        assertEquals(ScreenTimeMode.ACTIVE, state.mode)

        state = tick(state, 55.minutes.inWholeNanoseconds + 20.minutes.inWholeNanoseconds)
        assertEquals(ScreenTimeMode.BREAK_SHIELD, state.mode)
    }

    // ---- emergency exception (floor) ---------------------------------------

    @Test
    fun `emergency exception freezes enforcement and exactly restores prior state on deactivate`() {
        var state = tick(ScreenTimeState.initial(0L), 60.minutes.inWholeNanoseconds)
        assertEquals(ScreenTimeMode.BREAK_SHIELD, state.mode)
        val breakElapsedBeforeEmergency = state.breakElapsedNanos

        state = ScreenTimeEngine.reduce(
            state,
            ScreenTimeEvent.EmergencyExceptionActivate(60.minutes.inWholeNanoseconds),
            config,
        )
        assertEquals(ScreenTimeMode.EMERGENCY_EXCEPTION, state.mode)

        // an hour passes during the emergency; nothing should accumulate anywhere.
        state = tick(state, 120.minutes.inWholeNanoseconds)
        assertEquals(ScreenTimeMode.EMERGENCY_EXCEPTION, state.mode)

        state = ScreenTimeEngine.reduce(
            state,
            ScreenTimeEvent.EmergencyExceptionDeactivate(120.minutes.inWholeNanoseconds),
            config,
        )

        assertEquals(ScreenTimeMode.BREAK_SHIELD, state.mode)
        assertEquals(breakElapsedBeforeEmergency, state.breakElapsedNanos)
    }

    @Test
    fun `emergency exception activation is idempotent`() {
        var state = tick(ScreenTimeState.initial(0L), 10.minutes.inWholeNanoseconds)
        state = ScreenTimeEngine.reduce(state, ScreenTimeEvent.EmergencyExceptionActivate(10.minutes.inWholeNanoseconds), config)
        val once = state
        state = ScreenTimeEngine.reduce(state, ScreenTimeEvent.EmergencyExceptionActivate(10.minutes.inWholeNanoseconds), config)

        assertEquals(once, state)
    }

    // ---- dhikr / remembrance ---------------------------------------------

    @Test
    fun `dhikr interaction is only tracked during BREAK_SHIELD and does not shorten it`() {
        var state = ScreenTimeState.initial(0L)
        state = ScreenTimeEngine.reduce(state, ScreenTimeEvent.DhikrInteraction(0L), config)
        assertEquals(0, state.dhikrInteractionCount) // ignored outside break

        state = tick(state, 60.minutes.inWholeNanoseconds)
        state = ScreenTimeEngine.reduce(state, ScreenTimeEvent.DhikrInteraction(60.minutes.inWholeNanoseconds), config)
        state = ScreenTimeEngine.reduce(state, ScreenTimeEvent.DhikrInteraction(60.minutes.inWholeNanoseconds), config)
        assertEquals(2, state.dhikrInteractionCount)

        val remainingBefore = ScreenTimeEngine.remainingBreakNanos(state, config)
        state = tick(state, 61.minutes.inWholeNanoseconds)
        assertEquals(remainingBefore - 1.minutes.inWholeNanoseconds, ScreenTimeEngine.remainingBreakNanos(state, config))
    }

    @Test
    fun `dhikr interaction counter resets on a new break cycle`() {
        var state = tick(ScreenTimeState.initial(0L), 60.minutes.inWholeNanoseconds)
        state = ScreenTimeEngine.reduce(state, ScreenTimeEvent.DhikrInteraction(60.minutes.inWholeNanoseconds), config)
        assertEquals(1, state.dhikrInteractionCount)

        state = tick(state, 90.minutes.inWholeNanoseconds) // completes the break
        assertEquals(0, state.dhikrInteractionCount)
    }

    // ---- counters -----------------------------------------------------------

    @Test
    fun `completed and overridden break counters are tracked independently`() {
        var state = tick(ScreenTimeState.initial(0L), 60.minutes.inWholeNanoseconds)
        state = tick(state, 90.minutes.inWholeNanoseconds) // natural completion #1
        assertEquals(1, state.completedBreakCount)

        state = tick(state, 150.minutes.inWholeNanoseconds) // natural completion #2
        assertEquals(2, state.completedBreakCount)

        state = tick(state, 210.minutes.inWholeNanoseconds) // into BREAK_SHIELD again
        assertEquals(ScreenTimeMode.BREAK_SHIELD, state.mode)
        state = ScreenTimeEngine.reduce(state, ScreenTimeEvent.ParentOverrideSkipBreak(210.minutes.inWholeNanoseconds), config)
        assertEquals(2, state.completedBreakCount)
        assertEquals(1, state.overriddenBreakCount)
    }
}
