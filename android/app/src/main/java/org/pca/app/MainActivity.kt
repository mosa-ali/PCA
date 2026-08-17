package org.pca.app

import android.Manifest
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.getValue
import androidx.compose.runtime.collectAsState
import org.pca.app.feature.webprotection.ui.SafeBrowserActivity
import org.pca.app.feature.youtube.ui.YouTubeModeActivity
import org.pca.app.runtime.graph.newLocalRequestId
import org.pca.app.runtime.ui.ChildHomeScreen
import org.pca.app.runtime.ui.CallStatePermissionPromptPolicy
import org.pca.app.security.ui.AdminSecurityActivity

/**
 * PCA-RUNTIME-ANDROID-1 Section 15: the pure launch shell is replaced by the real child status
 * surface, driven live by [org.pca.app.runtime.PcaRuntime.status] -- the composition root
 * ([PcaApplication.graph]) is already running by the time this Activity is created (Section 2),
 * so this screen only ever observes already-live state, never triggers initialization itself.
 *
 * Correction round Section 6/9: [ChildHomeScreen]'s Emergency Access / Parent Contact actions are
 * wired to the real [org.pca.app.runtime.PcaRuntime] paths here -- toggling the actual runtime
 * emergency exception, and creating a real (locally-queued, honestly PENDING_SYNC_LOCAL-until-sync)
 * child request -- rather than being visually present but functionally dead.
 */
class MainActivity : ComponentActivity() {
    private val readPhoneStatePermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) {
        (application as PcaApplication).graph.runtime.refreshCommunicationCallStateObserver()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val runtime = (application as PcaApplication).graph.runtime
        setContent {
            val status by runtime.status.collectAsState()
            MaterialTheme {
                ChildHomeScreen(
                    status = status,
                    onEmergencyAccess = {
                        if (status.isEmergencyExceptionActive) {
                            runtime.deactivateEmergencyException()
                        } else {
                            runtime.activateEmergencyException()
                        }
                    },
                    onRequestParentContact = {
                        runtime.createChildRequest(
                            requestId = newLocalRequestId(),
                            kind = "PARENT_CONTACT",
                            detail = "Child requested to contact parent",
                        )
                    },
                    onOpenSafeBrowser = {
                        startActivity(Intent(this@MainActivity, SafeBrowserActivity::class.java))
                    },
                    onOpenAdminSecurity = {
                        startActivity(Intent(this@MainActivity, AdminSecurityActivity::class.java))
                    },
                    onOpenYouTubeMode = {
                        startActivity(Intent(this@MainActivity, YouTubeModeActivity::class.java))
                    },
                    onRequestCallStatePermission = {
                        val hasPermission = androidx.core.content.ContextCompat.checkSelfPermission(
                            this@MainActivity,
                            Manifest.permission.READ_PHONE_STATE,
                        ) == android.content.pm.PackageManager.PERMISSION_GRANTED
                        val preferences = getSharedPreferences(PERMISSION_PREFS, MODE_PRIVATE)
                        when (CallStatePermissionPromptPolicy.nextAction(
                            hasPermission = hasPermission,
                            promptWasShown = preferences.getBoolean(PHONE_STATE_PROMPT_SHOWN, false),
                        )) {
                            CallStatePermissionPromptPolicy.Action.ALREADY_GRANTED -> runtime.refreshCommunicationCallStateObserver()
                            CallStatePermissionPromptPolicy.Action.REQUEST -> {
                                preferences.edit().putBoolean(PHONE_STATE_PROMPT_SHOWN, true).apply()
                                readPhoneStatePermissionLauncher.launch(Manifest.permission.READ_PHONE_STATE)
                            }
                            CallStatePermissionPromptPolicy.Action.OPEN_SETTINGS -> {
                                startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                                    data = Uri.parse("package:$packageName")
                                })
                            }
                        }
                    },
                )
            }
        }
    }

    private companion object {
        const val PERMISSION_PREFS = "pca_permission_prompts"
        const val PHONE_STATE_PROMPT_SHOWN = "read_phone_state_prompt_shown"
    }
}
