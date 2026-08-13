package org.pca.app.enrollment.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import org.pca.app.R
import org.pca.app.enrollment.EnrollmentState

/** PCA-16B: shared modifier marking a screen's main title as an accessibility heading, so
 * TalkBack/switch-access users can navigate the enrollment flow by heading. */
private val headingModifier = Modifier.semantics { heading() }

/**
 * Honest, minimal setup UI (mission Section 9): every state this composable renders reflects only
 * what [org.pca.app.enrollment.EnrollmentCoordinator] actually knows -- no state here ever claims
 * pairing/protection is active before the server has said so via a real, later status check (this
 * screen has no PAIRED/ACTIVE branch at all, matching [EnrollmentState] itself).
 */
@Composable
fun EnrollmentScreen(
    state: EnrollmentState,
    onLinkSubmitted: (String) -> Unit,
    onContinue: () -> Unit,
    onCheckStatus: () -> Unit = {},
) {
    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        when (state) {
            is EnrollmentState.NotEnrolled -> {
                var link by remember { mutableStateOf("") }
                Text(stringResource(R.string.enrollment_entry_title), style = MaterialTheme.typography.headlineSmall, modifier = headingModifier)
                Text(stringResource(R.string.enrollment_entry_body))
                OutlinedTextField(
                    value = link,
                    onValueChange = { link = it },
                    label = { Text(stringResource(R.string.enrollment_link_input_hint)) },
                )
                Button(onClick = { onLinkSubmitted(link) }) {
                    Text(stringResource(R.string.enrollment_continue_button))
                }
            }

            is EnrollmentState.InvitationReady -> {
                Text(stringResource(R.string.enrollment_entry_title), style = MaterialTheme.typography.headlineSmall, modifier = headingModifier)
                Button(onClick = onContinue) {
                    Text(stringResource(R.string.enrollment_continue_button))
                }
            }

            is EnrollmentState.PreparingKeys -> {
                CircularProgressIndicator()
                Text(stringResource(R.string.enrollment_preparing_keys))
            }

            is EnrollmentState.Bootstrapping -> {
                CircularProgressIndicator()
                Text(stringResource(R.string.enrollment_bootstrapping))
            }

            is EnrollmentState.PairingPending -> {
                Text(stringResource(R.string.enrollment_pairing_pending_title), style = MaterialTheme.typography.headlineSmall, modifier = headingModifier)
                Text(stringResource(R.string.enrollment_pairing_pending_body))
            }

            is EnrollmentState.FailedInvitationInvalid -> {
                Text(stringResource(R.string.enrollment_invitation_unavailable))
            }

            is EnrollmentState.FailedRetryable -> {
                Text(stringResource(R.string.enrollment_retryable_failure))
                Button(onClick = onContinue) {
                    Text(stringResource(R.string.enrollment_continue_button))
                }
            }

            is EnrollmentState.CryptoReviewRequired -> {
                Text(stringResource(R.string.enrollment_crypto_review_required))
            }

            is EnrollmentState.Revoked -> {
                Text(stringResource(R.string.enrollment_revoked))
            }

            is EnrollmentState.BootstrapResultUnknown -> {
                // PCA-ENROLLMENT-RUNTIME-2: BOOTSTRAP_AMBIGUOUS_RETRY_PROTOCOL_GAP is now closed
                // -- "Check status" is an explicit, human-directed action (never automatic) that
                // safely re-sends/recovers the SAME attempt; it can never create a second device.
                Text(stringResource(R.string.enrollment_result_unknown))
                Button(onClick = onCheckStatus) {
                    Text(stringResource(R.string.enrollment_check_status_button))
                }
            }

            is EnrollmentState.RecoveryPending -> {
                // Restored after a process/app restart or device reboot with an unresolved
                // ambiguous attempt on record -- honest, no claim of success or failure; recovery
                // is explicit/bounded, never an automatic retry loop (mission Section 20).
                Text(stringResource(R.string.enrollment_recovery_pending_title), style = MaterialTheme.typography.headlineSmall, modifier = headingModifier)
                Text(stringResource(R.string.enrollment_recovery_pending_body))
                Button(onClick = onCheckStatus) {
                    Text(stringResource(R.string.enrollment_check_status_button))
                }
            }
        }
    }
}
