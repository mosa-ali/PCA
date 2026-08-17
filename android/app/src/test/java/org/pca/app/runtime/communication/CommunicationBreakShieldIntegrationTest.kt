package org.pca.app.runtime.communication

import org.junit.Assert.assertEquals
import org.junit.Test
import org.pca.app.feature.screentime.engine.ScreenTimeConfig
import org.pca.app.feature.screentime.engine.ScreenTimeEngine
import org.pca.app.feature.screentime.engine.ScreenTimeEvent
import org.pca.app.feature.screentime.engine.ScreenTimeMode
import org.pca.app.feature.screentime.engine.ScreenTimeState
import kotlin.time.Duration.Companion.minutes

class CommunicationBreakShieldIntegrationTest {
    private val config = ScreenTimeConfig(activeThreshold = 60.minutes, breakDuration = 30.minutes)

    @Test
    fun `ringing advances recovery but answered call freezes only active call time`() {
        var now = 60.minutes.inWholeNanoseconds
        var state = ScreenTimeEngine.reduce(ScreenTimeState.initial(0L), ScreenTimeEvent.Tick(now), config)
        now += 10.minutes.inWholeNanoseconds
        state = ScreenTimeEngine.reduce(state, ScreenTimeEvent.Tick(now), config)
        assertEquals(10.minutes.inWholeNanoseconds, state.breakElapsedNanos)

        val coordinator = CommunicationExceptionCoordinator(
            onCommunicationStarted = {
                state = ScreenTimeEngine.reduce(state, ScreenTimeEvent.CommunicationExceptionActivate(now), config)
            },
            onCommunicationEnded = {
                state = ScreenTimeEngine.reduce(state, ScreenTimeEvent.CommunicationExceptionDeactivate(now), config)
            },
        )

        coordinator.onCallState(CommunicationExceptionCoordinator.CallState.RINGING)
        now += 1.minutes.inWholeNanoseconds
        state = ScreenTimeEngine.reduce(state, ScreenTimeEvent.Tick(now), config)
        assertEquals(11.minutes.inWholeNanoseconds, state.breakElapsedNanos)

        coordinator.onCallState(CommunicationExceptionCoordinator.CallState.OFFHOOK)
        assertEquals(ScreenTimeMode.COMMUNICATION_EXCEPTION, state.mode)
        now += 15.minutes.inWholeNanoseconds
        state = ScreenTimeEngine.reduce(state, ScreenTimeEvent.Tick(now), config)
        assertEquals(11.minutes.inWholeNanoseconds, state.preCommunicationBreakElapsedNanos)

        coordinator.onCallState(CommunicationExceptionCoordinator.CallState.IDLE)
        assertEquals(ScreenTimeMode.BREAK_SHIELD, state.mode)
        assertEquals(19.minutes.inWholeNanoseconds, ScreenTimeEngine.remainingBreakNanos(state, config))
    }
}
