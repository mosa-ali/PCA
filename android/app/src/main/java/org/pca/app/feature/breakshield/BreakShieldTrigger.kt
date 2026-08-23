package org.pca.app.feature.breakshield

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import org.pca.app.feature.screentime.engine.ScreenTimeConfig
import org.pca.app.feature.screentime.engine.ScreenTimeState

/**
 * PCA-3/PCA-RUNTIME-1 real-trigger wiring -- the piece that decides WHEN to surface
 * [org.pca.app.feature.breakshield.ui.BreakShieldActivity], mirroring
 * [org.pca.app.feature.eyedistance.shield.EyeRestShieldTrigger] EXACTLY (same false-to-true-edge
 * discipline, same `distinctUntilChanged` anti-duplicate-fire guard).
 *
 * Before this class existed AND was wired into `PcaAppGraph`, [BreakShieldController]/
 * [BreakShieldScreen] were real, unit-tested, but never actually shown to a child: the
 * `ScreenTimeEngine`'s `BREAK_SHIELD` mode was tracked purely as internal state (surfaced only as
 * a status ROW inside [org.pca.app.runtime.ui.ChildHomeScreen], visible only if the child happens
 * to already have the PCA app open) -- there was no code path anywhere that actually launched the
 * full-screen shield a child is meant to see (and interact with -- dhikr, "ask a parent", the
 * always-present emergency-call action) once a mandatory break genuinely starts. This is the
 * closure of that gap, in the same shape this codebase already established for eye-rest.
 *
 * Pure/testable: given a [ScreenTimeState] stream, calls [onShieldShouldAppear] on every
 * false-to-true edge of [BreakShieldViewState.isShieldVisible] and nothing on any other
 * transition (repeated BREAK_SHIELD ticks, a shield that was already visible, or it becoming
 * hidden). `distinctUntilChanged` means a duplicate/near-duplicate tick from
 * [org.pca.app.runtime.PcaRuntime.tick] can never re-fire this.
 */
class BreakShieldTrigger(
    private val screenTimeStateFlow: Flow<ScreenTimeState>,
    private val config: ScreenTimeConfig,
    private val externalScope: CoroutineScope,
    private val onShieldShouldAppear: () -> Unit,
) {
    private var job: Job? = null

    fun start() {
        if (job != null) return
        job = externalScope.launch {
            screenTimeStateFlow
                .map { state -> BreakShieldController.viewState(state, config).isShieldVisible }
                .distinctUntilChanged()
                .collect { isVisible -> if (isVisible) onShieldShouldAppear() }
        }
    }

    fun stop() {
        job?.cancel()
        job = null
    }
}
