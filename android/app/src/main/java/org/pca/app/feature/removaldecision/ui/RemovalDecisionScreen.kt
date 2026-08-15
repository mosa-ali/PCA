package org.pca.app.feature.removaldecision.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import org.pca.app.feature.removaldecision.RemovalDecisionRecord
import org.pca.app.feature.removaldecision.RemovalDecisionState
import java.text.DateFormat
import java.util.Date

/**
 * Gap item 4: real UI for the removal/disable decision subsystem, reached
 * only after the caller has already gated entry behind
 * [org.pca.app.security.ThrottledAdminPinVerifier] or
 * [org.pca.app.security.BiometricAuthGate] (this screen itself performs no
 * authentication -- same "screen has no direct backing-store/auth access"
 * shape as [org.pca.app.feature.settings.ui.DeleteNowScreen] and
 * [org.pca.app.security.ui.AdminPinScreen]). Only offers the three
 * decision buttons while [record]'s state is
 * [RemovalDecisionState.PARENT_APPROVAL_REQUIRED] -- for every other
 * state it shows the current status only, since
 * [org.pca.app.feature.removaldecision.RemovalDecisionStateMachine]
 * would reject a decision call from any other state anyway.
 */
@Composable
fun RemovalDecisionScreen(
    record: RemovalDecisionRecord,
    onKeepActive: () -> Unit,
    onTemporarilyDisable: (untilEpochMillis: Long) -> Unit,
    onAllowRemoval: () -> Unit,
) {
    var confirmingAllowRemoval by remember { mutableStateOf(false) }

    Column(modifier = Modifier.padding(16.dp)) {
        Text(
            text = stringResource(R.string.removal_decision_title),
            style = MaterialTheme.typography.titleLarge,
            modifier = Modifier.semantics { heading() },
        )

        Text(text = statusText(record), modifier = Modifier.padding(top = 8.dp))

        if (record.state == RemovalDecisionState.PARENT_APPROVAL_REQUIRED) {
            Button(onClick = onKeepActive, modifier = Modifier.padding(top = 16.dp)) {
                Text(stringResource(R.string.removal_decision_keep_active_button))
            }
            Button(
                onClick = { onTemporarilyDisable(System.currentTimeMillis() + DEFAULT_TEMPORARY_DISABLE_WINDOW_MILLIS) },
                modifier = Modifier.padding(top = 8.dp),
            ) { Text(stringResource(R.string.removal_decision_temporarily_disable_button)) }
            Button(
                onClick = { confirmingAllowRemoval = true },
                modifier = Modifier.padding(top = 8.dp),
            ) { Text(stringResource(R.string.removal_decision_allow_removal_button)) }
        }
    }

    if (confirmingAllowRemoval) {
        AlertDialog(
            onDismissRequest = { confirmingAllowRemoval = false },
            title = { Text(stringResource(R.string.removal_decision_allow_removal_confirm_title)) },
            text = { Text(stringResource(R.string.removal_decision_allow_removal_confirm_message)) },
            confirmButton = {
                TextButton(onClick = { confirmingAllowRemoval = false; onAllowRemoval() }) {
                    Text(stringResource(R.string.removal_decision_confirm_button))
                }
            },
            dismissButton = {
                TextButton(onClick = { confirmingAllowRemoval = false }) {
                    Text(stringResource(R.string.removal_decision_cancel_button))
                }
            },
        )
    }
}

/** Default temporary-disable window offered by the quick action button: 1 hour. Chosen to be short enough that a parent granting it is making a bounded, low-risk decision, never an effectively-permanent one by default. */
private const val DEFAULT_TEMPORARY_DISABLE_WINDOW_MILLIS = 60L * 60L * 1000L

@Composable
private fun statusText(record: RemovalDecisionRecord): String = when (record.state) {
    RemovalDecisionState.KEEP_ACTIVE -> stringResource(R.string.removal_decision_state_keep_active)
    RemovalDecisionState.PARENT_APPROVAL_REQUIRED -> stringResource(R.string.removal_decision_state_pending)
    RemovalDecisionState.TEMPORARILY_DISABLE -> {
        val until = record.temporarilyDisabledUntilEpochMillis
        val formatted = if (until != null) DateFormat.getDateTimeInstance().format(Date(until)) else ""
        stringResource(R.string.removal_decision_state_temporarily_disabled, formatted)
    }
    RemovalDecisionState.ALLOW_REMOVAL -> stringResource(R.string.removal_decision_state_allow_removal)
}
