package org.pca.app.feature.eyedistance.shield

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.pca.app.feature.eyedistance.engine.EyeDistanceConfig
import org.pca.app.feature.eyedistance.engine.EyeDistancePhase
import org.pca.app.feature.eyedistance.engine.EyeDistanceState

class EyeDistanceShieldViewStateTest {

    private val config = EyeDistanceConfig()

    @Test
    fun `shield is visible exactly when REST_ACTIVE and no exception is in progress`() {
        val state = EyeDistanceState(phase = EyeDistancePhase.REST_ACTIVE)
        val viewState = EyeDistanceShieldController.viewState(state, config)
        assertTrue(viewState.isShieldVisible)
    }

    @Test
    fun `shield is not visible during MONITORING`() {
        val state = EyeDistanceState(phase = EyeDistancePhase.MONITORING)
        val viewState = EyeDistanceShieldController.viewState(state, config)
        assertFalse(viewState.isShieldVisible)
    }

    @Test
    fun `an active exception hides the shield even during REST_ACTIVE, transparently reflecting engine state`() {
        val state = EyeDistanceState(phase = EyeDistancePhase.REST_ACTIVE, exceptionActive = true)
        val viewState = EyeDistanceShieldController.viewState(state, config)
        assertFalse(viewState.isShieldVisible)
        assertTrue(viewState.isExceptionActive)
    }

    @Test
    fun `remaining rest reflects the engine's own countdown, not a separately tracked value`() {
        val state = EyeDistanceState(phase = EyeDistancePhase.REST_ACTIVE, restElapsedNanos = 40_000_000_000L)
        val viewState = EyeDistanceShieldController.viewState(state, config)
        assertEquals(20_000_000_000L, viewState.remainingRest.inWholeNanoseconds)
    }
}
