package org.pca.app.enrollment

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.getValue
import androidx.compose.runtime.collectAsState
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch
import org.pca.app.PcaApplication
import org.pca.app.enrollment.ui.EnrollmentScreen

/**
 * The child-device setup entry point (mission Section 9/10). Reachable two ways: directly (the
 * "Set up this device" launcher path) or via the `pca://enroll?token=...` deep link
 * (AndroidManifest.xml's intent-filter, host/scheme matching
 * [EnrollmentDeepLinkConfig] exactly). Never performs enrollment covertly -- every transition is
 * driven by [EnrollmentCoordinator] and visibly reflected in [EnrollmentScreen].
 */
class EnrollmentActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val coordinator = (application as PcaApplication).graph.enrollmentCoordinator

        intent?.dataString?.let { coordinator.submitInvitationLink(it) }

        setContent {
            val state by coordinator.state.collectAsState()
            MaterialTheme {
                EnrollmentScreen(
                    state = state,
                    onLinkSubmitted = { link -> coordinator.submitInvitationLink(link) },
                    onContinue = { lifecycleScope.launch { coordinator.beginBootstrap() } },
                )
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        intent.dataString?.let {
            (application as PcaApplication).graph.enrollmentCoordinator.submitInvitationLink(it)
        }
    }
}
