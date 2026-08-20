package org.pca.app.feature.eyedistance.shield

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import org.pca.app.R
import org.pca.app.feature.breakshield.formatDuration
import org.pca.app.feature.eyedistance.engine.EyeDistancePhase

/**
 * PCA-FR-021: the child-facing "one-minute eye-rest action" screen -- what a child actually sees
 * when [EyeDistanceShieldController.viewState] reports [EyeDistanceShieldViewState.isShieldVisible].
 * Renders that ViewState exactly, same "no separate hidden enforcement flag" discipline as
 * `BreakShieldScreen` (this feature's own doc comment explicitly models this screen after that
 * one, reusing [formatDuration] rather than re-implementing it).
 *
 * Doc 13/PCA-FR-021: "1-minute eye-rest action shown/completed" -- there is no
 * [org.pca.app.feature.eyedistance.engine.EyeDistanceEvent] that lets a caller manually cut the
 * rest short (contrast [org.pca.app.feature.eyedistance.engine.EyeDistanceEvent.ExceptionActivate],
 * which freezes rather than skips it), so this screen intentionally offers no "dismiss"/"skip"
 * affordance -- only the emergency-exception escape hatch the engine itself models via
 * [EyeDistanceShieldViewState.canRequestEmergencyException]. Inventing an early-dismiss button here
 * would contradict the state machine this is meant to render honestly.
 *
 * PCA-FR-023: copy never claims a precise measurement ("your eyes were close to the screen", not a
 * distance/measurement claim), and this surface makes no body/appearance/health scoring claim of
 * any kind -- it is a rest prompt, not a diagnosis.
 *
 * Copy tier: ships SIMPLE-tier strings only (`eye_rest_shield_*`) as the safe default for a screen
 * that may interrupt a young child -- unlike `EnrollmentScreen.kt`'s `disclosureCopyForTier()`, no
 * `AgeUxTier`/reading-level signal reaches this surface today (it would require plumbing through
 * `PcaRuntime`/`PcaAppGraph`, both outside this change's scope). Reading-level differentiation for
 * this screen remains a follow-up, tracked but not blocking PCA-FR-021 itself.
 */
@Composable
fun EyeRestShieldScreen(
    state: EyeDistanceShieldViewState,
    onRequestEmergencyException: () -> Unit,
) {
    if (!state.isShieldVisible) return

    val locale = LocalConfiguration.current.locales[0]
    val remainingText = formatDuration(state.remainingRest, locale)
    val remainingTimeA11y = stringResource(R.string.eye_rest_shield_remaining_time_a11y, remainingText)
    val emergencyButtonHint = stringResource(R.string.emergency_button_hint)

    MaterialTheme {
        Surface(modifier = Modifier.fillMaxSize()) {
            Column(
                modifier = Modifier.fillMaxSize().padding(24.dp),
                verticalArrangement = Arrangement.Center,
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text(
                    text = stringResource(R.string.eye_rest_shield_title),
                    style = MaterialTheme.typography.headlineMedium,
                    modifier = Modifier.semantics { heading() },
                )
                Text(
                    text = stringResource(R.string.eye_rest_shield_body),
                    style = MaterialTheme.typography.bodyLarge,
                )
                Text(
                    text = stringResource(R.string.eye_rest_shield_remaining_time, remainingText),
                    style = MaterialTheme.typography.bodyLarge,
                    modifier = Modifier.semantics {
                        liveRegion = LiveRegionMode.Polite
                        contentDescription = remainingTimeA11y
                    },
                )
                // Doc 13/lane brief Section 11 discipline (mirrored from BreakShieldScreen): the
                // emergency-exception escape hatch is never conditionally hidden by anything other
                // than the exception state itself (EyeDistanceShieldViewState.canRequestEmergencyException).
                if (state.canRequestEmergencyException) {
                    Button(
                        onClick = onRequestEmergencyException,
                        modifier = Modifier.semantics { contentDescription = emergencyButtonHint },
                    ) { Text(stringResource(R.string.emergency_button_label)) }
                }
            }
        }
    }
}

@Preview(showBackground = true)
@Composable
private fun EyeRestShieldScreenPreview() {
    EyeRestShieldScreen(
        state = EyeDistanceShieldViewState(
            isShieldVisible = true,
            remainingRest = kotlin.time.Duration.parse("PT45S"),
            canRequestEmergencyException = true,
            isExceptionActive = false,
            platformEnforcementPermitted = true,
            phase = EyeDistancePhase.REST_ACTIVE,
        ),
        onRequestEmergencyException = {},
    )
}
