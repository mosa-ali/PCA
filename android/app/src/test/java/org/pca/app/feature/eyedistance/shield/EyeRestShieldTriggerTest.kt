package org.pca.app.feature.eyedistance.shield

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test
import org.pca.app.feature.eyedistance.engine.EyeDistanceConfig
import org.pca.app.feature.eyedistance.engine.EyeDistancePhase
import org.pca.app.feature.eyedistance.engine.EyeDistanceState

/**
 * PCA-FR-021: [EyeRestShieldTrigger] decides WHEN to launch the shield surface, on top of the
 * already-tested [EyeDistanceShieldController] (see [EyeDistanceShieldViewStateTest]) deciding
 * what to render once it is up. Mirrors this feature's existing resolver-test discipline (e.g.
 * `EyeDistanceCameraPermissionUiStateResolverTest`): exercise the pure decision surface directly,
 * with a fake state stream, never a real platform/Activity dependency.
 */
class EyeRestShieldTriggerTest {

    private val config = EyeDistanceConfig()

    @Test
    fun `fires exactly once on the false-to-true edge of isShieldVisible`() = runTest {
        val stateFlow = MutableStateFlow(EyeDistanceState(phase = EyeDistancePhase.MONITORING))
        var fireCount = 0
        val trigger = EyeRestShieldTrigger(
            eyeDistanceStateFlow = stateFlow,
            config = config,
            platformEnforcementPermitted = { true },
            externalScope = this,
            onShieldShouldAppear = { fireCount++ },
        )

        trigger.start()
        advanceUntilIdle()
        assertEquals(0, fireCount)

        stateFlow.value = EyeDistanceState(phase = EyeDistancePhase.REST_ACTIVE)
        advanceUntilIdle()
        assertEquals(1, fireCount)

        trigger.stop()
    }

    @Test
    fun `repeated REST_ACTIVE ticks never re-fire`() = runTest {
        val stateFlow = MutableStateFlow(EyeDistanceState(phase = EyeDistancePhase.REST_ACTIVE, restElapsedNanos = 0L))
        var fireCount = 0
        val trigger = EyeRestShieldTrigger(
            eyeDistanceStateFlow = stateFlow,
            config = config,
            platformEnforcementPermitted = { true },
            externalScope = this,
            onShieldShouldAppear = { fireCount++ },
        )

        trigger.start()
        advanceUntilIdle()
        assertEquals(1, fireCount)

        stateFlow.value = EyeDistanceState(phase = EyeDistancePhase.REST_ACTIVE, restElapsedNanos = 10_000_000_000L)
        advanceUntilIdle()
        assertEquals(1, fireCount)

        trigger.stop()
    }

    @Test
    fun `never fires when platform enforcement is not permitted`() = runTest {
        val stateFlow = MutableStateFlow(EyeDistanceState(phase = EyeDistancePhase.MONITORING))
        var fireCount = 0
        val trigger = EyeRestShieldTrigger(
            eyeDistanceStateFlow = stateFlow,
            config = config,
            platformEnforcementPermitted = { false },
            externalScope = this,
            onShieldShouldAppear = { fireCount++ },
        )

        trigger.start()
        stateFlow.value = EyeDistanceState(phase = EyeDistancePhase.REST_ACTIVE)
        advanceUntilIdle()
        assertEquals(0, fireCount)

        trigger.stop()
    }

    @Test
    fun `hides and can re-fire on a second genuine REST_ACTIVE entry after RECOVERY`() = runTest {
        val stateFlow = MutableStateFlow(EyeDistanceState(phase = EyeDistancePhase.REST_ACTIVE))
        var fireCount = 0
        val trigger = EyeRestShieldTrigger(
            eyeDistanceStateFlow = stateFlow,
            config = config,
            platformEnforcementPermitted = { true },
            externalScope = this,
            onShieldShouldAppear = { fireCount++ },
        )

        trigger.start()
        advanceUntilIdle()
        assertEquals(1, fireCount)

        stateFlow.value = EyeDistanceState(phase = EyeDistancePhase.RECOVERY)
        advanceUntilIdle()
        assertEquals(1, fireCount)

        stateFlow.value = EyeDistanceState(phase = EyeDistancePhase.MONITORING)
        advanceUntilIdle()

        stateFlow.value = EyeDistanceState(phase = EyeDistancePhase.REST_ACTIVE)
        advanceUntilIdle()
        assertEquals(2, fireCount)

        trigger.stop()
    }
}
