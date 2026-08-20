package org.pca.app.feature.eyedistance.shield

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import org.pca.app.feature.eyedistance.engine.EyeDistanceConfig
import org.pca.app.feature.eyedistance.engine.EyeDistanceState

/**
 * PCA-FR-021 real-trigger wiring (the piece that decides WHEN to surface [EyeRestShieldActivity],
 * as opposed to [EyeDistanceShieldController], which only decides what the screen should render
 * once it is already up). Pure/testable: given a state stream, it does exactly one thing -- call
 * [onShieldShouldAppear] on every false-to-true edge of
 * [EyeDistanceShieldViewState.isShieldVisible], and nothing on any other transition (repeated
 * REST_ACTIVE ticks, a shield that was already visible, or it becoming hidden). `distinctUntilChanged`
 * plus mapping to the boolean first means a duplicate/near-duplicate tick from
 * [org.pca.app.runtime.PcaRuntime.tick] can never re-fire this.
 *
 * INTEGRATION CLOSURE: `org.pca.app.runtime.graph.PcaAppGraph` now constructs the real, single
 * production `eyeRestShieldTrigger` -- fed `org.pca.app.runtime.PcaRuntime.eyeDistanceState`
 * (the same instance the whole app runs against) and a `platformEnforcementPermitted` lambda that
 * always returns `true`, deliberately matching [EyeRestShieldActivity]'s own hardcoded claim of the
 * same name so the two can never disagree about `isShieldVisible`. Its
 * [onShieldShouldAppear] callback is `PcaAppGraph.launchEyeRestShieldActivity()`, which calls
 * `context.startActivity(Intent(context, EyeRestShieldActivity::class.java).addFlags(FLAG_ACTIVITY_NEW_TASK))`.
 * `PcaAppGraph.start()` calls `eyeRestShieldTrigger.start()` exactly once per process (idempotent,
 * same discipline as every other observer that method starts), so a real REST_ACTIVE transition now
 * launches [EyeRestShieldActivity] on its own, with no double-observation of the state flow.
 */
class EyeRestShieldTrigger(
    private val eyeDistanceStateFlow: Flow<EyeDistanceState>,
    private val config: EyeDistanceConfig,
    private val platformEnforcementPermitted: () -> Boolean,
    private val externalScope: CoroutineScope,
    private val onShieldShouldAppear: () -> Unit,
) {
    private var job: Job? = null

    fun start() {
        if (job != null) return
        job = externalScope.launch {
            eyeDistanceStateFlow
                .map { state ->
                    EyeDistanceShieldController.viewState(state, config, platformEnforcementPermitted()).isShieldVisible
                }
                .distinctUntilChanged()
                .collect { isVisible -> if (isVisible) onShieldShouldAppear() }
        }
    }

    fun stop() {
        job?.cancel()
        job = null
    }
}
