package org.pca.app.feature.eyedistance.engine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.pca.app.platform.proximity.ProximityReading
import kotlin.time.Duration.Companion.seconds

class EyeDistanceEngineTest {

    private val config = EyeDistanceConfig(
        nearSustainedThreshold = 7.seconds,
        restDuration = 60.seconds,
        persistentNearEpisodesForRest = 3,
    )

    private fun observe(state: EyeDistanceState, nowNanos: Long, reading: ProximityReading, available: Boolean = true): EyeDistanceState =
        EyeDistanceEngine.reduce(state, EyeDistanceEvent.Observation(nowNanos, reading, available), config)

    private fun fresh(): EyeDistanceState = EyeDistanceState(phase = EyeDistancePhase.MONITORING, lastTickMonotonicNanos = 0L)

    // ---- NEAR / FAR / UNKNOWN classification -----------------------------

    @Test
    fun `NEAR reading below threshold moves to SUSPECTED_NEAR, never invents a distance`() {
        val state = observe(fresh(), 3.seconds.inWholeNanoseconds, ProximityReading.NEAR)
        assertEquals(EyeDistancePhase.SUSPECTED_NEAR, state.phase)
        assertEquals(3.seconds.inWholeNanoseconds, state.nearElapsedNanos)
    }

    @Test
    fun `FAR reading keeps MONITORING`() {
        val state = observe(fresh(), 3.seconds.inWholeNanoseconds, ProximityReading.FAR)
        assertEquals(EyeDistancePhase.MONITORING, state.phase)
        assertEquals(0L, state.nearElapsedNanos)
    }

    @Test
    fun `UNKNOWN reading from MONITORING stays MONITORING, never treated as NEAR`() {
        val state = observe(fresh(), 3.seconds.inWholeNanoseconds, ProximityReading.UNKNOWN)
        assertEquals(EyeDistancePhase.MONITORING, state.phase)
        assertEquals(0L, state.nearElapsedNanos)
    }

    @Test
    fun `sensor unavailable from MONITORING moves to UNAVAILABLE, not SUSPENDED`() {
        val fresh = EyeDistanceState(phase = EyeDistancePhase.UNAVAILABLE, lastTickMonotonicNanos = 0L)
        val state = observe(fresh, 1.seconds.inWholeNanoseconds, ProximityReading.UNKNOWN, available = false)
        assertEquals(EyeDistancePhase.UNAVAILABLE, state.phase)
    }

    // ---- short/transient vs sustained near -------------------------------

    @Test
    fun `short transient near (2s) does not trigger WARNING`() {
        val state = observe(fresh(), 2.seconds.inWholeNanoseconds, ProximityReading.NEAR)
        assertEquals(EyeDistancePhase.SUSPECTED_NEAR, state.phase)
        assertTrue(state.phase != EyeDistancePhase.WARNING)
    }

    @Test
    fun `sustained near crossing the 7s threshold triggers WARNING`() {
        val state = observe(fresh(), 7.seconds.inWholeNanoseconds, ProximityReading.NEAR)
        assertEquals(EyeDistancePhase.WARNING, state.phase)
    }

    @Test
    fun `just before threshold stays SUSPECTED_NEAR`() {
        val justBefore = 7.seconds.inWholeNanoseconds - 1
        val state = observe(fresh(), justBefore, ProximityReading.NEAR)
        assertEquals(EyeDistancePhase.SUSPECTED_NEAR, state.phase)
    }

    // ---- warning threshold / rest threshold / rest completion ------------

    @Test
    fun `a single WARNING episode alone does not trigger REST_DUE`() {
        val state = observe(fresh(), 7.seconds.inWholeNanoseconds, ProximityReading.NEAR)
        assertEquals(EyeDistancePhase.WARNING, state.phase)
    }

    @Test
    fun `three separate persistent-near episodes trigger REST_DUE`() {
        var state = fresh()
        var t = 0L
        repeat(3) { episode ->
            // sustain NEAR into WARNING -- except the 3rd episode, which crosses the
            // persistent-near threshold on the very same observation and goes straight to
            // REST_DUE rather than pausing at WARNING first.
            t += 7.seconds.inWholeNanoseconds
            state = observe(state, t, ProximityReading.NEAR)
            if (episode < 2) {
                assertEquals(EyeDistancePhase.WARNING, state.phase)
            }
            if (episode < 2) {
                // recover fully back to MONITORING before the next episode
                t += 3.seconds.inWholeNanoseconds
                state = observe(state, t, ProximityReading.FAR)
                assertEquals(EyeDistancePhase.MONITORING, state.phase)
            }
        }
        assertEquals(EyeDistancePhase.REST_DUE, state.phase)
    }

    @Test
    fun `REST_DUE unconditionally advances to REST_ACTIVE on next observation`() {
        val restDue = tripleWarningState()
        val state = observe(restDue.first, restDue.second + 1L, ProximityReading.UNKNOWN, available = false)
        assertEquals(EyeDistancePhase.REST_ACTIVE, state.phase)
        assertEquals(0L, state.restElapsedNanos)
    }

    @Test
    fun `rest completes at exactly 60s and clears to RECOVERY then MONITORING`() {
        val (restDueState, restDueTime) = tripleWarningState()
        var state = observe(restDueState, restDueTime + 1L, ProximityReading.UNKNOWN)
        assertEquals(EyeDistancePhase.REST_ACTIVE, state.phase)

        val justBefore = restDueTime + 1L + 60.seconds.inWholeNanoseconds - 1
        state = observe(state, justBefore, ProximityReading.UNKNOWN)
        assertEquals(EyeDistancePhase.REST_ACTIVE, state.phase)

        val exact = restDueTime + 1L + 60.seconds.inWholeNanoseconds
        state = observe(state, exact, ProximityReading.UNKNOWN)
        assertEquals(EyeDistancePhase.RECOVERY, state.phase)

        state = observe(state, exact + 1L, ProximityReading.FAR)
        assertEquals(EyeDistancePhase.MONITORING, state.phase)
        assertEquals(0L, state.nearElapsedNanos)
    }

    // ---- pocket / hand false-positive resistance --------------------------

    @Test
    fun `a quick noisy near sample followed by far does not accumulate toward rest`() {
        var state = fresh()
        var t = 0L
        repeat(5) {
            t += 1.seconds.inWholeNanoseconds
            state = observe(state, t, ProximityReading.NEAR)
            t += 4.seconds.inWholeNanoseconds
            state = observe(state, t, ProximityReading.FAR)
        }
        assertTrue(state.phase == EyeDistancePhase.MONITORING || state.phase == EyeDistancePhase.SUSPECTED_NEAR)
        assertTrue(state.phase != EyeDistancePhase.REST_DUE)
        assertTrue(state.phase != EyeDistancePhase.REST_ACTIVE)
    }

    @Test
    fun `far sustained recovers WARNING back to MONITORING`() {
        var state = observe(fresh(), 7.seconds.inWholeNanoseconds, ProximityReading.NEAR)
        assertEquals(EyeDistancePhase.WARNING, state.phase)

        state = observe(state, 7.seconds.inWholeNanoseconds + 3.seconds.inWholeNanoseconds, ProximityReading.FAR)
        assertEquals(EyeDistancePhase.MONITORING, state.phase)
        assertEquals(0L, state.nearElapsedNanos)
    }

    // ---- exceptions: emergency / call / video call / accessibility -------

    @Test
    fun `exception activation freezes near-evidence accrual`() {
        var state = observe(fresh(), 3.seconds.inWholeNanoseconds, ProximityReading.NEAR)
        assertEquals(EyeDistancePhase.SUSPECTED_NEAR, state.phase)

        state = EyeDistanceEngine.reduce(state, EyeDistanceEvent.ExceptionActivate(4.seconds.inWholeNanoseconds), config)
        assertTrue(state.exceptionActive)

        // 100 seconds of "near" evidence arrive while the exception is active -- none of it counts.
        state = observe(state, 104.seconds.inWholeNanoseconds, ProximityReading.NEAR)
        assertEquals(3.seconds.inWholeNanoseconds, state.nearElapsedNanos)
        assertTrue(state.phase != EyeDistancePhase.REST_DUE)
        assertTrue(state.phase != EyeDistancePhase.WARNING)
    }

    @Test
    fun `exception deactivation resumes evidence accrual from where it left off`() {
        var state = observe(fresh(), 3.seconds.inWholeNanoseconds, ProximityReading.NEAR)
        state = EyeDistanceEngine.reduce(state, EyeDistanceEvent.ExceptionActivate(4.seconds.inWholeNanoseconds), config)
        state = EyeDistanceEngine.reduce(state, EyeDistanceEvent.ExceptionDeactivate(50.seconds.inWholeNanoseconds), config)

        state = observe(state, 50.seconds.inWholeNanoseconds + 4.seconds.inWholeNanoseconds, ProximityReading.NEAR)
        assertEquals(EyeDistancePhase.WARNING, state.phase)
        assertEquals(7.seconds.inWholeNanoseconds, state.nearElapsedNanos)
    }

    @Test
    fun `an already-active REST does not advance while an exception is active`() {
        val (restDueState, restDueTime) = tripleWarningState()
        var state = observe(restDueState, restDueTime + 1L, ProximityReading.UNKNOWN)
        assertEquals(EyeDistancePhase.REST_ACTIVE, state.phase)

        val exceptionStart = restDueTime + 1L + 10.seconds.inWholeNanoseconds
        state = EyeDistanceEngine.reduce(state, EyeDistanceEvent.ExceptionActivate(exceptionStart), config)

        // 1000 seconds pass while an emergency call is active -- the rest timer must not advance.
        state = observe(state, exceptionStart + 1000.seconds.inWholeNanoseconds, ProximityReading.UNKNOWN)
        assertEquals(EyeDistancePhase.REST_ACTIVE, state.phase)
        assertEquals(10.seconds.inWholeNanoseconds, state.restElapsedNanos)
    }

    @Test
    fun `duplicate ExceptionActivate events are idempotent`() {
        var state = fresh()
        state = EyeDistanceEngine.reduce(state, EyeDistanceEvent.ExceptionActivate(1L), config)
        val preExceptionPhaseAfterFirst = state.preExceptionPhase
        state = EyeDistanceEngine.reduce(state, EyeDistanceEvent.ExceptionActivate(2L), config)
        assertEquals(preExceptionPhaseAfterFirst, state.preExceptionPhase)
        assertTrue(state.exceptionActive)
    }

    // ---- process/reboot recovery handled in EyeDistanceRestorerTest -------

    // ---- clock/duplicate/out-of-order safety ------------------------------

    @Test
    fun `duplicate observation at same timestamp is a no-op for accrual`() {
        var state = observe(fresh(), 3.seconds.inWholeNanoseconds, ProximityReading.NEAR)
        val before = state.nearElapsedNanos
        state = observe(state, 3.seconds.inWholeNanoseconds, ProximityReading.NEAR)
        assertEquals(before, state.nearElapsedNanos)
    }

    @Test
    fun `an out-of-order (earlier) timestamp never regresses the monotonic reference`() {
        var state = observe(fresh(), 10.seconds.inWholeNanoseconds, ProximityReading.NEAR)
        val referenceBefore = state.lastTickMonotonicNanos
        state = observe(state, 5.seconds.inWholeNanoseconds, ProximityReading.NEAR)
        assertEquals(referenceBefore, state.lastTickMonotonicNanos)
    }

    @Test
    fun `a backwards clock jump never fabricates negative elapsed accrual`() {
        var state = observe(fresh(), 10.seconds.inWholeNanoseconds, ProximityReading.NEAR)
        val nearBefore = state.nearElapsedNanos
        // A wall/monotonic-clock anomaly delivering an earlier "now" must clamp to zero delta,
        // never subtract.
        state = observe(state, 2.seconds.inWholeNanoseconds, ProximityReading.NEAR)
        assertEquals(nearBefore, state.nearElapsedNanos)
    }

    // ---- helpers ------------------------------------------------------------

    /** Drives the engine through three persistent-near episodes and returns (REST_DUE state, itsTimestamp). */
    private fun tripleWarningState(): Pair<EyeDistanceState, Long> {
        var state = fresh()
        var t = 0L
        repeat(3) { episode ->
            t += 7.seconds.inWholeNanoseconds
            state = observe(state, t, ProximityReading.NEAR)
            if (episode < 2) {
                t += 3.seconds.inWholeNanoseconds
                state = observe(state, t, ProximityReading.FAR)
            }
        }
        return state to t
    }
}
