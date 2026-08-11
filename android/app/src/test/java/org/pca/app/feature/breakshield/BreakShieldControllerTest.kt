package org.pca.app.feature.breakshield

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.pca.app.feature.screentime.engine.ScreenTimeConfig
import org.pca.app.feature.screentime.engine.ScreenTimeEngine
import org.pca.app.feature.screentime.engine.ScreenTimeEvent
import org.pca.app.feature.screentime.engine.ScreenTimeState
import kotlin.time.Duration.Companion.minutes

class BreakShieldControllerTest {

    private val config = ScreenTimeConfig(activeThreshold = 60.minutes, breakDuration = 30.minutes)

    @Test
    fun `shield is not visible while ACTIVE`() {
        val state = ScreenTimeState.initial(0L)
        val view = BreakShieldController.viewState(state, config)

        assertFalse(view.isShieldVisible)
        assertFalse(view.canInteractWithDhikr)
        assertEquals(60.minutes.inWholeNanoseconds, view.remainingActiveBeforeBreak.inWholeNanoseconds)
    }

    @Test
    fun `shield is visible and reports remaining break time`() {
        val state = ScreenTimeEngine.reduce(ScreenTimeState.initial(0L), ScreenTimeEvent.Tick(70.minutes.inWholeNanoseconds), config)
        val view = BreakShieldController.viewState(state, config)

        assertTrue(view.isShieldVisible)
        assertEquals(20.minutes.inWholeNanoseconds, view.remainingBreak.inWholeNanoseconds)
        assertTrue(view.canInteractWithDhikr)
        assertTrue(view.canRequestParentOverride)
    }

    @Test
    fun `emergency exception is reflected transparently in the view state`() {
        val inBreak = ScreenTimeEngine.reduce(ScreenTimeState.initial(0L), ScreenTimeEvent.Tick(70.minutes.inWholeNanoseconds), config)
        val emergency = ScreenTimeEngine.reduce(inBreak, ScreenTimeEvent.EmergencyExceptionActivate(70.minutes.inWholeNanoseconds), config)
        val view = BreakShieldController.viewState(emergency, config)

        assertFalse(view.isShieldVisible)
        assertTrue(view.isEmergencyExceptionActive)
        assertFalse(view.canRequestEmergencyException)
    }
}
