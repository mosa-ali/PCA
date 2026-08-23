package org.pca.app.feature.breakshield

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test
import org.pca.app.feature.screentime.engine.ScreenTimeConfig
import org.pca.app.feature.screentime.engine.ScreenTimeMode
import org.pca.app.feature.screentime.engine.ScreenTimeState

/**
 * PCA-3/PCA-RUNTIME-1: [BreakShieldTrigger] decides WHEN to launch the shield surface, on top of
 * the already-tested [BreakShieldController] (see [BreakShieldControllerTest]) deciding what to
 * render once it is up. Mirrors [org.pca.app.feature.eyedistance.shield.EyeRestShieldTriggerTest]'s
 * discipline exactly: exercise the pure decision surface directly, with a fake state stream, never
 * a real platform/Activity dependency.
 */
class BreakShieldTriggerTest {

    private val config = ScreenTimeConfig()

    @Test
    fun `fires exactly once on the false-to-true edge of isShieldVisible`() = runTest {
        val stateFlow = MutableStateFlow(ScreenTimeState.initial(0L))
        var fireCount = 0
        val trigger = BreakShieldTrigger(
            screenTimeStateFlow = stateFlow,
            config = config,
            externalScope = this,
            onShieldShouldAppear = { fireCount++ },
        )

        trigger.start()
        advanceUntilIdle()
        assertEquals(0, fireCount)

        stateFlow.value = stateFlow.value.copy(mode = ScreenTimeMode.BREAK_SHIELD)
        advanceUntilIdle()
        assertEquals(1, fireCount)

        trigger.stop()
    }

    @Test
    fun `repeated BREAK_SHIELD ticks never re-fire`() = runTest {
        val stateFlow = MutableStateFlow(ScreenTimeState.initial(0L).copy(mode = ScreenTimeMode.BREAK_SHIELD))
        var fireCount = 0
        val trigger = BreakShieldTrigger(
            screenTimeStateFlow = stateFlow,
            config = config,
            externalScope = this,
            onShieldShouldAppear = { fireCount++ },
        )

        trigger.start()
        advanceUntilIdle()
        assertEquals(1, fireCount)

        stateFlow.value = stateFlow.value.copy(breakElapsedNanos = 10_000_000_000L)
        advanceUntilIdle()
        assertEquals(1, fireCount)

        trigger.stop()
    }

    @Test
    fun `hides and can re-fire on a second genuine BREAK_SHIELD entry after completing`() = runTest {
        val stateFlow = MutableStateFlow(ScreenTimeState.initial(0L).copy(mode = ScreenTimeMode.BREAK_SHIELD))
        var fireCount = 0
        val trigger = BreakShieldTrigger(
            screenTimeStateFlow = stateFlow,
            config = config,
            externalScope = this,
            onShieldShouldAppear = { fireCount++ },
        )

        trigger.start()
        advanceUntilIdle()
        assertEquals(1, fireCount)

        stateFlow.value = stateFlow.value.copy(mode = ScreenTimeMode.ACTIVE)
        advanceUntilIdle()

        stateFlow.value = stateFlow.value.copy(mode = ScreenTimeMode.BREAK_SHIELD)
        advanceUntilIdle()
        assertEquals(2, fireCount)

        trigger.stop()
    }

    @Test
    fun `a COMMUNICATION_EXCEPTION carried over from BREAK_SHIELD keeps the shield visible and never re-fires on its own`() = runTest {
        val stateFlow = MutableStateFlow(ScreenTimeState.initial(0L).copy(mode = ScreenTimeMode.BREAK_SHIELD))
        var fireCount = 0
        val trigger = BreakShieldTrigger(
            screenTimeStateFlow = stateFlow,
            config = config,
            externalScope = this,
            onShieldShouldAppear = { fireCount++ },
        )

        trigger.start()
        advanceUntilIdle()
        assertEquals(1, fireCount)

        stateFlow.value = stateFlow.value.copy(
            mode = ScreenTimeMode.COMMUNICATION_EXCEPTION,
            preCommunicationMode = ScreenTimeMode.BREAK_SHIELD,
        )
        advanceUntilIdle()
        // isShieldVisible stays true throughout (BreakShieldController's own COMMUNICATION_EXCEPTION
        // carry-over rule) -- no false-to-true edge occurs, so no second fire.
        assertEquals(1, fireCount)

        trigger.stop()
    }
}
