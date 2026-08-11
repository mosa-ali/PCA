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

    // ---- pause / resume / meaningful pause ----------------------------------
    // See MeaningfulPauseTest for the dedicated boundary tests (FINDING-001).

    @Test
    fun `a short pause preserves accumulated streak on resume`() {
        var state = tick(ScreenTimeState.initial(0L), 15.minutes.inWholeNanoseconds)
        state = ScreenTimeEngine.reduce(state, ScreenTimeEvent.Pause(15.minutes.inWholeNanoseconds), config)
        assertEquals(ScreenTimeMode.PAUSED, state.mode)

        // 2 minutes pass while paused, well under the default 5-minute meaningfulPause.
        state = tick(state, 17.minutes.inWholeNanoseconds)
        assertEquals(ScreenTimeMode.PAUSED, state.mode)
        assertEquals(15.minutes.inWholeNanoseconds, state.activeElapsedNanos)

        state = ScreenTimeEngine.reduce(state, ScreenTimeEvent.Resume(17.minutes.inWholeNanoseconds), config)
        assertEquals(ScreenTimeMode.ACTIVE, state.mode)
        assertEquals(15.minutes.inWholeNanoseconds, state.activeElapsedNanos)

        state = tick(state, 17.minutes.inWholeNanoseconds + 44.minutes.inWholeNanoseconds + 59.seconds.inWholeNanoseconds)
        assertEquals(ScreenTimeMode.ACTIVE, state.mode)

        state = tick(state, 17.minutes.inWholeNanoseconds + 45.minutes.inWholeNanoseconds)
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

    // See DhikrLifecycleTest for the full dhikr-counter lifecycle (NEW-001).

    // ---- counters -----------------------------------------------------------

    @Test
    fun `completed and overridden break counters are tracked independently`() {
        // Cycle 1: ACTIVE 0-60, BREAK_SHIELD 60-90 (completes naturally at 90).
        var state = tick(ScreenTimeState.initial(0L), 60.minutes.inWholeNanoseconds)
        state = tick(state, 90.minutes.inWholeNanoseconds)
        assertEquals(1, state.completedBreakCount)

        // Cycle 2: ACTIVE 90-150, BREAK_SHIELD 150-180 (completes naturally at 180).
        state = tick(state, 150.minutes.inWholeNanoseconds)
        assertEquals(ScreenTimeMode.BREAK_SHIELD, state.mode)
        state = tick(state, 180.minutes.inWholeNanoseconds)
        assertEquals(2, state.completedBreakCount)

        // Cycle 3: ACTIVE 180-240, BREAK_SHIELD entered at 240 — this one is overridden, not
        // completed naturally, so completedBreakCount must stay at 2.
        state = tick(state, 240.minutes.inWholeNanoseconds)
        assertEquals(ScreenTimeMode.BREAK_SHIELD, state.mode)

        val authorization = ParentAuthorization(
            approverId = "parent-1",
            scope = ParentOverrideScope.SKIP_BREAK,
            boundedDuration = kotlin.time.Duration.ZERO,
            issuedAtEpochMillis = 0L,
            expiresAtEpochMillis = 10_000L,
            auditId = "audit-1",
        )
        val result = ParentOverrideEngine.applySkipBreakRequest(
            state,
            SkipBreakRequest(nowNanos = 240.minutes.inWholeNanoseconds, nowWallClockMillis = 500L, authorization = authorization),
            org.pca.app.feature.screentime.persistence.InMemoryUsedAuthorizationStore(),
            config,
        )
        state = (result as ParentOverrideResult.Applied).state

        assertEquals(2, state.completedBreakCount)
        assertEquals(1, state.overriddenBreakCount)
    }
}
