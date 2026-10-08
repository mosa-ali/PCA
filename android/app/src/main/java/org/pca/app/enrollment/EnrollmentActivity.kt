package org.pca.app.enrollment

import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.getValue
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.launch
import org.pca.app.PcaApplication
import org.pca.app.R
import org.pca.app.accessibility.PcaAccessibilityContent
import org.pca.app.enrollment.ui.EnrollmentScreen
import org.pca.app.runtime.graph.PcaAppGraph

/**
 * The child-device setup entry point (mission Section 9/10). Reachable two ways: directly (the
 * "Set up this device" launcher path) or through a validated custom-scheme/App Link invitation
 * (AndroidManifest.xml's intent filters match [EnrollmentDeepLinkConfig]). Consumed invitation
 * URI data is removed from the Activity's held Intent. Never performs enrollment covertly --
 * every transition is driven by [EnrollmentCoordinator] and visibly reflected in [EnrollmentScreen].
 */
class EnrollmentActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val graph = (application as PcaApplication).graph
        val coordinator = graph.enrollmentCoordinator
        val firstDeviceRootCoordinator = graph.firstDeviceTrustRootCoordinator

        val launchIntent = intent
        launchIntent?.dataString?.let { uri ->
            scheduleInvitationLink(graph, coordinator, uri)
        }
        // Android retains Activity launch intents for task restoration. Remove the bearer link
        // from the Activity's held intent after passing it to the in-memory coordinator.
        launchIntent?.data = null
        if (launchIntent != null) setIntent(launchIntent)

        setContent {
            PcaAccessibilityContent {
                val state by coordinator.state.collectAsState()
                val keyFingerprints by coordinator.keyFingerprints.collectAsState()
                // EnrollmentCoordinator captures the durable seed directly into the shared
                // graph store before publishing PairingPending. The root coordinator's own
                // StateFlow is initialized at graph construction, so keep this UI snapshot in
                // sync after enrollment confirmation and after each explicit root action.
                var firstDeviceRootRecord by remember {
                    mutableStateOf(graph.firstDeviceRootStore.current())
                }
                MaterialTheme {
                    EnrollmentScreen(
                        state = state,
                        keyFingerprints = keyFingerprints,
                        firstDeviceRootRecord = firstDeviceRootRecord,
                        onLinkSubmitted = { link -> scheduleInvitationLink(graph, coordinator, link) },
                        onContinue = {
                            lifecycleScope.launch {
                                when (state) {
                                    is EnrollmentState.FailedRetryable -> coordinator.retryBootstrap()
                                    is EnrollmentState.InvitationReady -> coordinator.beginBootstrap()
                                    else -> Unit
                                }
                            }
                        },
                        onProfileConfirmed = {
                            coordinator.confirmProfile()
                            firstDeviceRootRecord = graph.firstDeviceRootStore.current()
                        },
                        // PCA-ENROLLMENT-RUNTIME-2: status recovery is an explicit human action.
                        // Exact tuple replay is exposed as a separate action below; neither path is automatic.
                        onCheckStatus = {
                            lifecycleScope.launch {
                                when (state) {
                                    is EnrollmentState.BootstrapResultUnknown -> coordinator.recoverAttempt()
                                    is EnrollmentState.RecoveryPending -> coordinator.recoverAttempt()
                                    else -> Unit
                                }
                            }
                        },
                        onRetrySameSetup = {
                            lifecycleScope.launch {
                                if (state is EnrollmentState.BootstrapResultUnknown) coordinator.retryBootstrap()
                            }
                        },
                        // Root review begins only from a visible user action in PairingPending.
                        // No composition/lifecycle callback starts a ceremony automatically.
                        onStartFirstDeviceRootReview = {
                            lifecycleScope.launch {
                                firstDeviceRootCoordinator.beginCeremony()
                                firstDeviceRootRecord = graph.firstDeviceRootStore.current()
                            }
                        },
                        onRefreshFirstDeviceRootStatus = {
                            lifecycleScope.launch {
                                firstDeviceRootCoordinator.refreshStatus()
                                firstDeviceRootRecord = graph.firstDeviceRootStore.current()
                            }
                        },
                        onSubmitFirstDeviceRootProof = {
                            lifecycleScope.launch {
                                firstDeviceRootCoordinator.submit()
                                firstDeviceRootRecord = graph.firstDeviceRootStore.current()
                            }
                        },
                        onReplayFirstDeviceRootProof = {
                            lifecycleScope.launch {
                                firstDeviceRootCoordinator.resubmitExact()
                                firstDeviceRootRecord = graph.firstDeviceRootStore.current()
                            }
                        },
                    )
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        val graph = (application as PcaApplication).graph
        intent.dataString?.let { uri ->
            scheduleInvitationLink(graph, graph.enrollmentCoordinator, uri)
        }
        intent.data = null
        setIntent(intent)
    }

    private fun scheduleInvitationLink(
        graph: PcaAppGraph,
        coordinator: EnrollmentCoordinator,
        uri: String,
    ) {
        val boundedUri = uri.takeIf { it.length <= EnrollmentDeepLinkConfig.MAX_INVITATION_URI_LENGTH } ?: ""
        val appContext = applicationContext
        val mainHandler = Handler(Looper.getMainLooper())
        fun showMessage(message: Int) {
            mainHandler.post {
                Toast.makeText(appContext, message, Toast.LENGTH_LONG).show()
            }
        }

        val admission = coordinator.reserveInvitationSubmission()
        if (admission == null) {
            showMessage(R.string.enrollment_link_already_waiting)
            return
        }
        if (admission.waitsForCurrentOperation) showMessage(R.string.enrollment_link_waiting)

        try {
            val job = graph.coroutineScope.launch(start = CoroutineStart.UNDISPATCHED) {
                try {
                    when (coordinator.submitReservedInvitationLink(boundedUri, admission.permit)) {
                        InvitationSubmissionResult.PROCESSED,
                        InvitationSubmissionResult.ALREADY_WAITING -> Unit
                        InvitationSubmissionResult.REOPEN_AFTER_CONFIRMATION ->
                            showMessage(R.string.enrollment_link_finish_profile_then_reopen)
                        InvitationSubmissionResult.CURRENT_INVITATION_ALREADY_IN_USE ->
                            showMessage(R.string.enrollment_link_current_invitation_in_use)
                        InvitationSubmissionResult.CURRENT_INVITATION_UNVERIFIED ->
                            showMessage(R.string.enrollment_link_current_invitation_unverified)
                        InvitationSubmissionResult.REJECTED_UNRESOLVED ->
                            showMessage(R.string.enrollment_link_rejected_unresolved)
                    }
                } finally {
                    admission.permit.release()
                }
            }
            // Also releases the permit if the app scope was already cancelled and the body never
            // entered. release() is idempotent because normal completion releases it in `finally`.
            job.invokeOnCompletion { admission.permit.release() }
        } catch (failure: Throwable) {
            admission.permit.release()
            throw failure
        }
    }
}
