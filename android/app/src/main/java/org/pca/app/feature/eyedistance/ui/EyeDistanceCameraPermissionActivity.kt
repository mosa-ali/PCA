package org.pca.app.feature.eyedistance.ui

import android.Manifest
import android.content.pm.PackageManager
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import org.pca.app.accessibility.PcaAccessibilityContent

/**
 * PCA-PRIV-001 / PCA-FR-023/024 closure: the real host Activity for
 * [EyeDistanceCameraPermissionScreen] -- that disclosure screen previously existed with no launch
 * site anywhere in the app (see its own doc comment, and [EyeDistanceCameraFeatureAvailability]'s
 * now-flipped constant). This is the ONLY place in this app that ever requests the CAMERA runtime
 * permission -- [org.pca.app.runtime.graph.PcaAppGraph]'s `hasCameraPermission` accessor only ever
 * READS the current grant state, it never prompts for it.
 *
 * "Not now" (or simply backing out) finishes this Activity with no permission request ever made,
 * matching PCA-PRIV-001's "the family may decline without losing any other PCA feature": every
 * other PCA feature is already composed and running in `PcaApplication.graph` independently of
 * whether this screen is ever opened, and the Tier 1 [org.pca.app.platform.proximity.HardwareProximitySource]
 * continues to work with no camera involved at all.
 *
 * Reachable today from the parent-authenticated [org.pca.app.security.ui.AdminSecurityActivity]
 * surface (see that Activity's own doc comment for why). This app has no shared Compose `NavHost`
 * anywhere under `src/main` -- a dedicated, narrowly-scoped Activity is this codebase's existing
 * pattern for a new reachable screen (mirrors `SafeBrowserActivity`, `YouTubeModeActivity`,
 * `AdminSecurityActivity` itself), not a gap unique to this feature.
 */
class EyeDistanceCameraPermissionActivity : ComponentActivity() {

    private lateinit var uiState: MutableState<EyeDistanceCameraPermissionUiState>

    private val requestCameraPermission = registerForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted ->
        if (!granted) markExplicitlyDenied()
        refreshUiState()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            PcaAccessibilityContent {
                MaterialTheme {
                    Surface {
                        val state = remember { mutableStateOf(currentUiState()) }
                        uiState = state
                        EyeDistanceCameraPermissionScreen(
                            state = state.value,
                            onAllowClick = { requestCameraPermission.launch(Manifest.permission.CAMERA) },
                            onNotNowClick = { finish() },
                            modifier = Modifier.padding(24.dp),
                        )
                    }
                }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        // Covers the case where the family instead granted/denied camera permission from the OS
        // Settings screen while this Activity was backgrounded (same discipline as
        // MainActivity.onResume's phone-state-permission refresh).
        refreshUiState()
    }

    private fun refreshUiState() {
        if (::uiState.isInitialized) uiState.value = currentUiState()
    }

    private fun currentUiState(): EyeDistanceCameraPermissionUiState {
        val hasPermission = ContextCompat.checkSelfPermission(
            this,
            Manifest.permission.CAMERA,
        ) == PackageManager.PERMISSION_GRANTED
        val explicitlyDenied = getSharedPreferences(PERMISSION_PREFS, MODE_PRIVATE)
            .getBoolean(CAMERA_PERMISSION_EXPLICITLY_DENIED, false)
        return EyeDistanceCameraPermissionUiStateResolver.resolve(
            featureAvailable = EyeDistanceCameraFeatureAvailability.CAMERA_PROXIMITY_ESTIMATION_AVAILABLE,
            hasCameraPermission = hasPermission,
            permissionExplicitlyDenied = explicitlyDenied,
        )
    }

    private fun markExplicitlyDenied() {
        getSharedPreferences(PERMISSION_PREFS, MODE_PRIVATE)
            .edit()
            .putBoolean(CAMERA_PERMISSION_EXPLICITLY_DENIED, true)
            .apply()
    }

    private companion object {
        const val PERMISSION_PREFS = "pca_permission_prompts"
        const val CAMERA_PERMISSION_EXPLICITLY_DENIED = "camera_permission_explicitly_denied"
    }
}
