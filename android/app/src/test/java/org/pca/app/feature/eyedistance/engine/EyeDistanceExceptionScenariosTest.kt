package org.pca.app.feature.eyedistance.engine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.pca.app.platform.proximity.ProximityReading
import kotlin.time.Duration.Companion.seconds

/**
 * Doc 13 / task Section 2 names four exception scenarios (emergency access, an active ordinary
 * call, an active video call, an approved accessibility exception). The engine intentionally
 * models all four with the same [EyeDistanceEvent.ExceptionActivate]/[EyeDistanceEvent.ExceptionDeactivate]
 * pair (see that type's own doc) -- these tests exist to name each scenario explicitly for
 * traceability against the required test matrix, on top of the mechanism-level coverage in
 * [EyeDistanceEngineTest].
 */
class EyeDistanceExceptionScenariosTest {

    private val config = EyeDistanceConfig()

    private fun startWarning(): EyeDistanceState {
        val fresh = EyeDistanceState(phase = EyeDistancePhase.MONITORING, lastTickMonotonicNanos = 0L)
        return EyeDistanceEngine.reduce(fresh, EyeDistanceEvent.Observation(7.seconds.inWholeNanoseconds, ProximityReading.NEAR, true), config)
    }

    @Test
    fun `emergency access is never blocked by an in-progress near evaluation`() {
        var state = startWarning()
        state = EyeDistanceEngine.reduce(state, EyeDistanceEvent.ExceptionActivate(8.seconds.inWholeNanoseconds), config)
        assertTrue(state.exceptionActive)
        // No mechanism in this engine can prevent ExceptionActivate from succeeding regardless of phase.
    }

    @Test
    fun `an active ordinary call suspends near-evidence judgment for its duration`() {
        var state = startWarning()
        state = EyeDistanceEngine.reduce(state, EyeDistanceEvent.ExceptionActivate(8.seconds.inWholeNanoseconds), config)
        state = EyeDistanceEngine.reduce(state, EyeDistanceEvent.Observation(30.seconds.inWholeNanoseconds, ProximityReading.NEAR, true), config)
        assertEquals(7.seconds.inWholeNanoseconds, state.nearElapsedNanos)
        state = EyeDistanceEngine.reduce(state, EyeDistanceEvent.ExceptionDeactivate(40.seconds.inWholeNanoseconds), config)
        assertTrue(!state.exceptionActive)
    }

    @Test
    fun `an active video call is treated identically to an ordinary call by the engine`() {
        var state = startWarning()
        state = EyeDistanceEngine.reduce(state, EyeDistanceEvent.ExceptionActivate(8.seconds.inWholeNanoseconds), config)
        assertEquals(EyeDistancePhase.WARNING, state.preExceptionPhase)
    }

    @Test
    fun `an approved accessibility exception freezes evidence exactly like any other exception`() {
        var state = startWarning()
        state = EyeDistanceEngine.reduce(state, EyeDistanceEvent.ExceptionActivate(8.seconds.inWholeNanoseconds), config)
        state = EyeDistanceEngine.reduce(state, EyeDistanceEvent.Observation(100.seconds.inWholeNanoseconds, ProximityReading.NEAR, true), config)
        assertTrue(state.phase != EyeDistancePhase.REST_DUE)
    }
}
