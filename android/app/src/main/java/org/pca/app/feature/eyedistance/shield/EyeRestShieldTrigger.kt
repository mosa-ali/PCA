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
 * KNOWN INTEGRATION GAP (documented rather than fabricated -- see this feature's task notes):
 * nothing in production actually constructs an [EyeRestShieldTrigger] today. The natural real
 * inputs already exist and are exactly what this class needs --
 * `org.pca.app.runtime.PcaRuntime.eyeDistanceState` (a public `StateFlow<EyeDistanceState>`) and
 * `org.pca.app.runtime.graph.PcaAppGraph.protectionCapabilities` -- but constructing this trigger
 * with those real values and supplying an [onShieldShouldAppear] callback that actually calls
 * `context.startActivity(Intent(context, EyeRestShieldActivity::class.java).addFlags(FLAG_ACTIVITY_NEW_TASK))`
 * (or posts a full-screen-intent notification, for the case where the app is backgrounded) has to
 * happen from `PcaAppGraph.start()` or `PcaApplication.onCreate()` -- both outside this change's
 * allowed file scope (everything under `feature/eyedistance` plus `res/values{,-ar}/strings.xml`
 * only). A second,
 * separately-scoped change must add that composition-root call; without it, [EyeRestShieldActivity]
 * is reachable only if launched directly (e.g. from a test or a future manual entry point), never
 * automatically from a real REST_ACTIVE transition.
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
