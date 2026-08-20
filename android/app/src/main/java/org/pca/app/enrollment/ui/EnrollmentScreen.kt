package org.pca.app.enrollment.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
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
import org.pca.app.enrollment.DeviceKeyFingerprints
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
    onProfileConfirmed: () -> Unit = {},
    onCheckStatus: () -> Unit = {},
    /** PCA-FR-140/141: this device's own DSK/DEK fingerprints (org.pca.app.enrollment.EnrollmentCoordinator.keyFingerprints), shown once available so the parent can visually compare them against the parent app's own display of the same device's fingerprints. */
    keyFingerprints: DeviceKeyFingerprints? = null,
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
                // PCA-FR-007/142: a distinct informed-consent summary gates every transition out
                // of InvitationReady -- including the add-another-device path, since this same
                // composable (and this same state) is re-entered from scratch for each device this
                // flow enrolls. onContinue (-> EnrollmentCoordinator.beginBootstrap) is reachable
                // ONLY through explicit acceptance here, never automatically.
                InformedConsentStep(onAccept = onContinue)
            }

            is EnrollmentState.ProfileConfirmation -> {
                ChildProfileConfirmationStep(state, onConfirm = onProfileConfirmed)
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
                if (keyFingerprints != null) {
                    KeyFingerprintConfirmation(keyFingerprints)
                }
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

/**
 * PCA-FR-140/141: displays this device's own DSK/DEK fingerprints as a plain-language, colon/
 * hyphen-delimited hex string so the parent can visually compare them (short authentication
 * string style) against the same fingerprints shown by the parent app
 * (parent-web/src/pages/family/DeviceEnrollmentPanel.tsx's `dskFingerprint`/`dekFingerprint`,
 * sourced from the identical `computeKeyFingerprint` algorithm server-side). Purely a local
 * computation on this screen -- no network call is made to render it.
 */
@Composable
private fun KeyFingerprintConfirmation(fingerprints: DeviceKeyFingerprints) {
    Column {
        Text(
            stringResource(R.string.enrollment_fingerprint_confirmation_title),
            style = MaterialTheme.typography.titleMedium,
            modifier = Modifier.semantics { heading() },
        )
        Text(stringResource(R.string.enrollment_fingerprint_confirmation_body))
        Text(stringResource(R.string.enrollment_dsk_fingerprint_label, fingerprints.signingKeyFingerprint))
        Text(stringResource(R.string.enrollment_dek_fingerprint_label, fingerprints.encryptionKeyFingerprint))
    }
}

/**
 * PCA-FR-007/142: the informed-consent summary -- what will and will not be monitored -- shown
 * once per enrollment attempt (fresh again for a second/third device, since it is reached via
 * [EnrollmentState.InvitationReady], which this composable's caller re-enters from scratch on
 * every fresh [org.pca.app.enrollment.EnrollmentCoordinator.submitInvitationLink] call). Visually
 * and structurally distinct from every other state's ordinary progress text: a heading, two
 * labelled lists, and a single explicit acceptance action -- there is no path from
 * [EnrollmentState.InvitationReady] to bootstrap that bypasses this screen.
 */
@Composable
private fun InformedConsentStep(onAccept: () -> Unit) {
    val monitoredItems = listOf(
        stringResource(R.string.enrollment_consent_monitored_item_1),
        stringResource(R.string.enrollment_consent_monitored_item_2),
        stringResource(R.string.enrollment_consent_monitored_item_3),
        stringResource(R.string.enrollment_consent_monitored_item_4),
    )
    val notMonitoredItems = listOf(
        stringResource(R.string.enrollment_consent_not_monitored_item_1),
        stringResource(R.string.enrollment_consent_not_monitored_item_2),
        stringResource(R.string.enrollment_consent_not_monitored_item_3),
    )

    Column(modifier = Modifier.fillMaxSize()) {
        Text(
            stringResource(R.string.enrollment_consent_title),
            style = MaterialTheme.typography.headlineSmall,
            modifier = Modifier.semantics { heading() },
        )
        LazyColumn(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            item { Text(stringResource(R.string.enrollment_consent_intro)) }
            item {
                Text(
                    stringResource(R.string.enrollment_consent_monitored_heading),
                    style = MaterialTheme.typography.titleMedium,
                    modifier = Modifier.semantics { heading() },
                )
            }
            items(monitoredItems) { Text("• $it") }
            item {
                Text(
                    stringResource(R.string.enrollment_consent_not_monitored_heading),
                    style = MaterialTheme.typography.titleMedium,
                    modifier = Modifier.semantics { heading() },
                )
            }
            items(notMonitoredItems) { Text("• $it") }
            item { Text(stringResource(R.string.enrollment_consent_emergency_note), style = MaterialTheme.typography.bodyMedium) }
        }
        Button(onClick = onAccept, modifier = Modifier.padding(top = 16.dp)) {
            Text(stringResource(R.string.enrollment_consent_accept_button))
        }
    }
}

/**
 * PCA-FR-008: child-side enrollment confirmation. The parent-selected profile is displayed from
 * the server bootstrap result and is intentionally not editable here, so a child cannot weaken a
 * stricter parent-authorized policy. The explicit action is still real: local enrollment state is
 * not committed until this confirmation callback succeeds.
 */
@Composable
private fun ChildProfileConfirmationStep(
    state: EnrollmentState.ProfileConfirmation,
    onConfirm: () -> Unit,
) {
    val ageLabel = when (state.ageUxTier) {
        org.pca.app.enrollment.AgeUxTier.YOUNG_CHILD -> stringResource(R.string.enrollment_profile_age_young_child)
        org.pca.app.enrollment.AgeUxTier.TEEN -> stringResource(R.string.enrollment_profile_age_teen)
    }
    val policyLabel = when (state.initialPolicyProfile) {
        org.pca.app.enrollment.InitialPolicyProfile.BALANCED -> stringResource(R.string.enrollment_profile_policy_balanced)
        org.pca.app.enrollment.InitialPolicyProfile.STRICT -> stringResource(R.string.enrollment_profile_policy_strict)
    }
    // PCA-NFR-044: the age tier genuinely selects a different-complexity string set at render
    // time -- simple/short copy for a young child, more complete copy for a teen -- mirroring
    // iOS's PCAChildReadingLevel selection in PCAEnrollmentDisclosure.forProfile(). Privacy and
    // emergency content (InformedConsentStep) is intentionally identical for every age tier.
    val disclosureCopy = disclosureCopyForTier(state.ageUxTier)

    Column(modifier = Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(
            stringResource(disclosureCopy.titleRes),
            style = MaterialTheme.typography.headlineSmall,
            modifier = headingModifier,
        )
        Text(stringResource(disclosureCopy.bodyRes))
        Text(stringResource(R.string.enrollment_profile_confirmation_age, ageLabel))
        Text(stringResource(R.string.enrollment_profile_confirmation_policy, policyLabel))
        Button(onClick = onConfirm) {
            Text(stringResource(disclosureCopy.confirmButtonRes))
        }
    }
}

/**
 * PCA-NFR-044: maps [org.pca.app.enrollment.AgeUxTier] (via [org.pca.app.enrollment.readingLevel])
 * to the age-appropriate reading-level string set for this disclosure/profile-confirmation
 * surface, mirroring iOS's `PCAEnrollmentDisclosure.forProfile()` two-variant approach (simple
 * copy for young children, more complete copy for teens).
 */
private data class EnrollmentDisclosureCopy(
    val readingLevel: org.pca.app.enrollment.ReadingLevel,
    @androidx.annotation.StringRes val titleRes: Int,
    @androidx.annotation.StringRes val bodyRes: Int,
    @androidx.annotation.StringRes val confirmButtonRes: Int,
)

private fun disclosureCopyForTier(ageUxTier: org.pca.app.enrollment.AgeUxTier): EnrollmentDisclosureCopy =
    when (ageUxTier) {
        org.pca.app.enrollment.AgeUxTier.YOUNG_CHILD -> EnrollmentDisclosureCopy(
            readingLevel = org.pca.app.enrollment.ReadingLevel.SIMPLE,
            titleRes = R.string.enrollment_profile_confirmation_title_simple,
            bodyRes = R.string.enrollment_profile_confirmation_body_simple,
            confirmButtonRes = R.string.enrollment_profile_confirmation_button_simple,
        )
        org.pca.app.enrollment.AgeUxTier.TEEN -> EnrollmentDisclosureCopy(
            readingLevel = org.pca.app.enrollment.ReadingLevel.CLEAR,
            titleRes = R.string.enrollment_profile_confirmation_title,
            bodyRes = R.string.enrollment_profile_confirmation_body,
            confirmButtonRes = R.string.enrollment_profile_confirmation_button,
        )
    }
