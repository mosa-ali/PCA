package org.pca.app.feature.eyedistance.shield

import org.pca.app.feature.eyedistance.engine.EyeDistanceConfig
import org.pca.app.feature.eyedistance.engine.EyeDistanceEngine
import org.pca.app.feature.eyedistance.engine.EyeDistancePhase
import org.pca.app.feature.eyedistance.engine.EyeDistanceState
import kotlin.time.Duration
import kotlin.time.Duration.Companion.nanoseconds

/**
 * Everything the eye-distance rest surface needs to render, derived purely from engine state --
 * same transparency discipline as PCA-3's `BreakShieldViewState` (PCA-3 doc Section 4): no
 * separate "hidden enforcement" flag, whatever the engine believes is exactly what is shown.
 *
 * Doc 13 / task Section 2: "reuse existing PCA-3 enforcement ladder -- do not create a competing
 * enforcement engine." This view state deliberately mirrors `BreakShieldViewState`'s shape so the
 * SAME physical shield presentation surface PCA-3 already built can render either one; no new
 * blocking/countdown mechanism is introduced here -- [EyeDistanceEngine] only ever decides WHEN a
 * rest is due/active, never how it is presented or enforced at the OS level. Wiring this view
 * state into the actual shared shield Composable is a Coordinator-level integration step (it
 * would touch shared UI files outside PCA-8's owned roots) -- see the integration queue entry.
 */
data class EyeDistanceShieldViewState(
    val isShieldVisible: Boolean,
    val remainingRest: Duration,
    val canRequestEmergencyException: Boolean,
    val isExceptionActive: Boolean,
    val platformEnforcementPermitted: Boolean,
    val phase: EyeDistancePhase,
)

object EyeDistanceShieldController {
    /**
     * Derives the child-facing eye-rest state. The caller must provide the real platform
     * capability; REST_ACTIVE alone is not evidence that a visible shield can be enforced. A
     * coordinator may pass false when the shared enforcement surface is unavailable, while the
     * engine's one-minute countdown remains intact and auditable in [remainingRest].
     */
    fun viewState(
        state: EyeDistanceState,
        config: EyeDistanceConfig,
        platformEnforcementPermitted: Boolean,
    ): EyeDistanceShieldViewState =
        EyeDistanceShieldViewState(
            isShieldVisible = platformEnforcementPermitted &&
                state.phase == EyeDistancePhase.REST_ACTIVE &&
                !state.exceptionActive,
            remainingRest = EyeDistanceEngine.remainingRestNanos(state, config).nanoseconds,
            canRequestEmergencyException = !state.exceptionActive,
            isExceptionActive = state.exceptionActive,
            platformEnforcementPermitted = platformEnforcementPermitted,
            phase = state.phase,
        )
}
