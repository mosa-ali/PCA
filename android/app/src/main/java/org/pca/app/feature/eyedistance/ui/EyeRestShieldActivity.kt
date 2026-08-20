package org.pca.app.feature.eyedistance.ui

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import org.pca.app.PcaApplication
import org.pca.app.accessibility.PcaAccessibilityContent
import org.pca.app.feature.eyedistance.engine.EyeDistanceConfig
import org.pca.app.feature.eyedistance.shield.EyeDistanceShieldController

/**
 * PCA-FR-021: the real host Activity for [org.pca.app.feature.eyedistance.shield.EyeRestShieldScreen]
 * -- the one-minute eye-rest action a child sees when [org.pca.app.runtime.PcaRuntime.eyeDistanceState]
 * reaches `REST_ACTIVE`. Mirrors [EyeDistanceCameraPermissionActivity]'s own pattern exactly (same
 * doc comment's reasoning applies here too: this app has no shared Compose `NavHost` anywhere under
 * `src/main`, so a dedicated, narrowly-scoped Activity is this codebase's existing pattern for a new
 * reachable screen).
 *
 * State is read directly off the real, already-running [org.pca.app.runtime.PcaRuntime] via
 * `(application as PcaApplication).graph.runtime` -- both `PcaApplication.graph` and
 * `PcaAppGraph.runtime` are already public, documented composition points (same access pattern
 * [org.pca.app.security.ui.AdminSecurityActivity] uses for `graph.deviceIdentityProvider`), so this
 * reads the graph without editing it. `platformEnforcementPermitted = true` here is a deliberate,
 * narrow claim: it asserts only that THIS shield-rendering surface is available, which is
 * necessarily true while this Activity itself is on screen -- it does not, and must not, imply
 * anything about `PlatformProtectionCapabilities.currentMode()` (that is an unrelated, DevicePolicy
 * device-owner concept; see that type's own doc comment).
 *
 * INTEGRATION CLOSURE: this Activity is now registered in `AndroidManifest.xml` (not exported, no
 * intent-filter, same pattern as [EyeDistanceCameraPermissionActivity]), and
 * `org.pca.app.runtime.graph.PcaAppGraph.eyeRestShieldTrigger` -- constructed from the real
 * `PcaRuntime.eyeDistanceState` -- calls `PcaAppGraph.launchEyeRestShieldActivity()` on every
 * false-to-true `isShieldVisible` edge, which fires the actual
 * `startActivity(Intent(context, EyeRestShieldActivity::class.java).addFlags(FLAG_ACTIVITY_NEW_TASK))`
 * call. See [org.pca.app.feature.eyedistance.shield.EyeRestShieldTrigger]'s own doc comment for the
 * trigger side of this wiring.
 */
class EyeRestShieldActivity : ComponentActivity() {

    private val config = EyeDistanceConfig()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val runtime = (application as PcaApplication).graph.runtime

        setContent {
            PcaAccessibilityContent {
                val eyeDistanceState by runtime.eyeDistanceState.collectAsState()
                val viewState = EyeDistanceShieldController.viewState(
                    state = eyeDistanceState,
                    config = config,
                    platformEnforcementPermitted = true,
                )

                // The engine itself decides when the rest ends (RECOVERY) or an emergency
                // exception freezes/hides it -- this Activity's only job is to stop showing
                // itself the moment isShieldVisible turns false, never to invent its own
                // separate dismissal condition.
                LaunchedEffect(viewState.isShieldVisible) {
                    if (!viewState.isShieldVisible) finish()
                }

                org.pca.app.feature.eyedistance.shield.EyeRestShieldScreen(
                    state = viewState,
                    onRequestEmergencyException = { runtime.activateEmergencyException() },
                )
            }
        }
    }
}
