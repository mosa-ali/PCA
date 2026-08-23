package org.pca.app.feature.breakshield.ui

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import org.pca.app.PcaApplication
import org.pca.app.accessibility.PcaAccessibilityContent
import org.pca.app.feature.breakshield.BreakShieldController
import org.pca.app.feature.breakshield.BreakShieldScreen
import org.pca.app.runtime.graph.newLocalRequestId

/**
 * PCA-3/PCA-RUNTIME-1 closure: the real host Activity for
 * [org.pca.app.feature.breakshield.BreakShieldScreen] -- the mandatory-break screen a child sees
 * when [org.pca.app.runtime.PcaRuntime.screenTimeState] reaches `ScreenTimeMode.BREAK_SHIELD`.
 * Mirrors [org.pca.app.feature.eyedistance.ui.EyeRestShieldActivity]'s own pattern exactly (this
 * app has no shared Compose `NavHost` anywhere under `src/main`, so a dedicated, narrowly-scoped
 * Activity is this codebase's existing pattern for a new reachable screen).
 *
 * State is read directly off the real, already-running [org.pca.app.runtime.PcaRuntime] via
 * `(application as PcaApplication).graph.runtime`/`graph.screenTimeConfig`, the SAME composition
 * points [org.pca.app.MainActivity] and `EyeRestShieldActivity` already use.
 *
 * INTEGRATION CLOSURE: this Activity is registered in `AndroidManifest.xml` (not exported, no
 * intent-filter, same pattern as `EyeRestShieldActivity`), and
 * `org.pca.app.runtime.graph.PcaAppGraph.breakShieldTrigger` -- constructed from the real
 * `PcaRuntime.screenTimeState` -- calls `PcaAppGraph.launchBreakShieldActivity()` on every
 * false-to-true `isShieldVisible` edge, which fires the actual
 * `startActivity(Intent(context, BreakShieldActivity::class.java).addFlags(FLAG_ACTIVITY_NEW_TASK))`
 * call. See [org.pca.app.feature.breakshield.BreakShieldTrigger]'s own doc comment for the trigger
 * side of this wiring.
 *
 * The three callbacks below are real, not decorative:
 *  - [onDhikrInteraction] drives [org.pca.app.runtime.PcaRuntime.recordDhikrInteraction] -- the
 *    SAME engine event `ScreenTimeEngine.applyDhikrInteraction` already handles; this Activity was
 *    the one missing caller.
 *  - "Ask a parent" reuses the SAME offline-safe `createChildRequest`/`PARENT_CONTACT` path
 *    [org.pca.app.MainActivity]'s `onRequestParentContact` already uses -- never a second, parallel
 *    request mechanism. A cryptographically-signed, single-use parent SKIP_BREAK/GRANT_TIME
 *    authorization (see `org.pca.app.feature.screentime.engine.ParentOverrideEngine`) remains a
 *    separate, later capability gated on the same PRODUCTION_CRYPTO_SUITE review as every other
 *    live family-sync path in this app (see `PcaAppGraph.familySyncRuntimePort`'s own doc comment)
 *    -- this button honestly creates a request a parent can see once sync exists, it does not
 *    fabricate an immediate override.
 *  - [onCallEmergencyServices]'s default (a real `ACTION_DIAL` intent) and the emergency-EXCEPTION
 *    button both remain exactly as real as they are everywhere else in this app --
 *    `activateEmergencyException()` is the SAME toggle `ChildHomeScreen`'s "Emergency Access" row
 *    already calls.
 */
class BreakShieldActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val graph = (application as PcaApplication).graph
        val runtime = graph.runtime

        setContent {
            PcaAccessibilityContent {
                val screenTimeState by runtime.screenTimeState.collectAsState()
                val viewState = BreakShieldController.viewState(screenTimeState, graph.screenTimeConfig)

                // The engine itself decides when the break ends (natural completion, a parent
                // override, or an emergency exception) -- this Activity's only job is to stop
                // showing itself the moment isShieldVisible turns false, never to invent its own
                // separate dismissal condition.
                LaunchedEffect(viewState.isShieldVisible) {
                    if (!viewState.isShieldVisible) finish()
                }

                BreakShieldScreen(
                    state = viewState,
                    onDhikrInteraction = { runtime.recordDhikrInteraction() },
                    onRequestParentOverride = {
                        runtime.createChildRequest(
                            requestId = newLocalRequestId(),
                            kind = "PARENT_CONTACT",
                            detail = "Child requested a parent override of the mandatory Break Shield.",
                        )
                    },
                    onRequestEmergencyException = { runtime.activateEmergencyException() },
                )
            }
        }
    }
}
