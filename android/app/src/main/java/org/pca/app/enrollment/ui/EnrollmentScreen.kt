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
import androidx.compose.ui.unit.dp
import org.pca.app.R
import org.pca.app.enrollment.EnrollmentState

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
) {
    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        when (state) {
            is EnrollmentState.NotEnrolled -> {
                var link by remember { mutableStateOf("") }
                Text(stringResource(R.string.enrollment_entry_title), style = MaterialTheme.typography.headlineSmall)
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
                Text(stringResource(R.string.enrollment_entry_title), style = MaterialTheme.typography.headlineSmall)
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
                Text(stringResource(R.string.enrollment_pairing_pending_title), style = MaterialTheme.typography.headlineSmall)
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
                // BOOTSTRAP_AMBIGUOUS_RETRY_PROTOCOL_GAP: no retry button here -- the copy itself
                // tells the user to check with their parent first, never a silent auto-retry.
                Text(stringResource(R.string.enrollment_result_unknown))
            }
        }
    }
}
