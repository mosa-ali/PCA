package org.pca.app.feature.breakshield

import org.pca.app.feature.screentime.engine.ScreenTimeConfig
import org.pca.app.feature.screentime.engine.ScreenTimeEngine
import org.pca.app.feature.screentime.engine.ScreenTimeMode
import org.pca.app.feature.screentime.engine.ScreenTimeState
import kotlin.time.Duration
import kotlin.time.Duration.Companion.nanoseconds

/**
 * Everything the Break Shield surface needs to render, derived purely from the engine state.
 * By construction there is no separate "hidden enforcement" flag: whatever the engine believes
 * is true is exactly what is shown to the child (see PCA-3 §4, transparency requirement).
 */
data class BreakShieldViewState(
    val isShieldVisible: Boolean,
    val remainingBreak: Duration,
    val dhikrInteractionCount: Int,
    val canInteractWithDhikr: Boolean,
    val canRequestParentOverride: Boolean,
    val canRequestEmergencyException: Boolean,
    val remainingActiveBeforeBreak: Duration,
    val completedBreakCount: Int,
    val overriddenBreakCount: Int,
    val isEmergencyExceptionActive: Boolean,
)

object BreakShieldController {
    fun viewState(state: ScreenTimeState, config: ScreenTimeConfig = ScreenTimeConfig()): BreakShieldViewState =
        BreakShieldViewState(
            isShieldVisible = state.mode == ScreenTimeMode.BREAK_SHIELD,
            remainingBreak = ScreenTimeEngine.remainingBreakNanos(state, config).nanoseconds,
            dhikrInteractionCount = state.dhikrInteractionCount,
            canInteractWithDhikr = state.mode == ScreenTimeMode.BREAK_SHIELD,
            canRequestParentOverride = state.mode == ScreenTimeMode.BREAK_SHIELD,
            canRequestEmergencyException = state.mode != ScreenTimeMode.EMERGENCY_EXCEPTION,
            remainingActiveBeforeBreak = ScreenTimeEngine.remainingActiveNanos(state, config).nanoseconds,
            completedBreakCount = state.completedBreakCount,
            overriddenBreakCount = state.overriddenBreakCount,
            isEmergencyExceptionActive = state.mode == ScreenTimeMode.EMERGENCY_EXCEPTION,
        )
}
