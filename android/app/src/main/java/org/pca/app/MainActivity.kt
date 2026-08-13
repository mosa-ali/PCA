package org.pca.app

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.getValue
import androidx.compose.runtime.collectAsState
import org.pca.app.feature.webprotection.ui.SafeBrowserActivity
import org.pca.app.runtime.graph.newLocalRequestId
import org.pca.app.runtime.ui.ChildHomeScreen

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
                )
            }
        }
    }
}
