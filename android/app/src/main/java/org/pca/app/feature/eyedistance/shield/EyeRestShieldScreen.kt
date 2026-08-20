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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import org.pca.app.PcaApplication
import org.pca.app.R
import org.pca.app.enrollment.AgeUxTier
import org.pca.app.enrollment.ReadingLevel
import org.pca.app.enrollment.readingLevel
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
 * Copy tier: PCA-NFR-044 closes the gap this screen originally shipped with (a single hardcoded
 * SIMPLE-tier variant) -- it now reads the real, persisted `AgeUxTier` the same way
 * `BreakShieldScreen`/`ChildHomeScreen` already do (see [resolveDeviceAgeUxTier]) and selects
 * between the CLEAR/TEEN-tier and SIMPLE/YOUNG_CHILD-tier string sets via
 * [eyeRestShieldCopyForTier], mirroring [org.pca.app.feature.breakshield.BreakShieldScreen]'s own
 * `breakShieldCopyForTier()` pattern exactly. Only wording complexity changes between tiers -- the
 * underlying substance (the rest is time-bound, the emergency-exception escape hatch always
 * remains reachable) is identical in both variants.
 */
@Composable
fun EyeRestShieldScreen(
    state: EyeDistanceShieldViewState,
    onRequestEmergencyException: () -> Unit,
    ageUxTier: AgeUxTier? = null,
) {
    if (!state.isShieldVisible) return

    val locale = LocalConfiguration.current.locales[0]
    val remainingText = formatDuration(state.remainingRest, locale)

    // PCA-NFR-044: the real, currently-enrolled age tier is read from the same persisted
    // FamilyStateStore the rest of the runtime graph already uses -- never a hardcoded default --
    // mirroring BreakShieldScreen.kt's/ChildHomeScreen.kt's resolveDeviceAgeUxTier(). A caller may
    // still pass [ageUxTier] explicitly (previews/tests); when omitted the real device state is
    // resolved here.
    val resolvedAgeUxTier = ageUxTier ?: resolveDeviceAgeUxTier()
    val copy = eyeRestShieldCopyForTier(resolvedAgeUxTier)

    val remainingTimeA11y = stringResource(copy.remainingTimeA11yRes, remainingText)
    val emergencyButtonHint = stringResource(R.string.emergency_button_hint)

    MaterialTheme {
        Surface(modifier = Modifier.fillMaxSize()) {
            Column(
                modifier = Modifier.fillMaxSize().padding(24.dp),
                verticalArrangement = Arrangement.Center,
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text(
                    text = stringResource(copy.titleRes),
                    style = MaterialTheme.typography.headlineMedium,
                    modifier = Modifier.semantics { heading() },
                )
                Text(
                    text = stringResource(copy.bodyRes),
                    style = MaterialTheme.typography.bodyLarge,
                )
                Text(
                    text = stringResource(copy.remainingTimeRes, remainingText),
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

/**
 * PCA-NFR-044: resolves the real, persisted [AgeUxTier] for this device from the same composition
 * root ([PcaApplication.graph]) the rest of the runtime already uses, mirroring
 * [org.pca.app.feature.breakshield.BreakShieldScreen]'s/[org.pca.app.runtime.ui.ChildHomeScreen]'s
 * own `resolveDeviceAgeUxTier()`. Falls back to [AgeUxTier.YOUNG_CHILD] (the stricter tier) only
 * when no enrolled family state exists yet or the hosting context isn't [PcaApplication] (e.g. a
 * Preview/test harness).
 */
@Composable
private fun resolveDeviceAgeUxTier(): AgeUxTier {
    val context = LocalContext.current
    return (context.applicationContext as? PcaApplication)
        ?.graph
        ?.familyStateStore
        ?.currentState()
        ?.ageUxTier
        ?: AgeUxTier.YOUNG_CHILD
}

/**
 * PCA-NFR-044: reading-level string set for the Eye Rest Shield surface, mirroring
 * [org.pca.app.enrollment.ui.EnrollmentScreen]'s `EnrollmentDisclosureCopy`/`disclosureCopyForTier`
 * pattern (also used by `BreakShieldCopy`/`ChildHomeCopy`). Only wording complexity changes
 * between tiers -- the underlying substance (the rest is time-bound, the emergency-exception
 * escape hatch always remains reachable) is identical in both variants.
 */
private data class EyeRestShieldCopy(
    val readingLevel: ReadingLevel,
    @androidx.annotation.StringRes val titleRes: Int,
    @androidx.annotation.StringRes val bodyRes: Int,
    @androidx.annotation.StringRes val remainingTimeRes: Int,
    @androidx.annotation.StringRes val remainingTimeA11yRes: Int,
    @androidx.annotation.StringRes val completedNoticeRes: Int,
)

private fun eyeRestShieldCopyForTier(ageUxTier: AgeUxTier): EyeRestShieldCopy = when (ageUxTier) {
    AgeUxTier.YOUNG_CHILD -> EyeRestShieldCopy(
        readingLevel = ageUxTier.readingLevel,
        titleRes = R.string.eye_rest_shield_title,
        bodyRes = R.string.eye_rest_shield_body_simple,
        remainingTimeRes = R.string.eye_rest_shield_remaining_time_simple,
        remainingTimeA11yRes = R.string.eye_rest_shield_remaining_time_a11y_simple,
        completedNoticeRes = R.string.eye_rest_shield_completed_notice_simple,
    )
    AgeUxTier.TEEN -> EyeRestShieldCopy(
        readingLevel = ageUxTier.readingLevel,
        titleRes = R.string.eye_rest_shield_title,
        bodyRes = R.string.eye_rest_shield_body,
        remainingTimeRes = R.string.eye_rest_shield_remaining_time,
        remainingTimeA11yRes = R.string.eye_rest_shield_remaining_time_a11y,
        completedNoticeRes = R.string.eye_rest_shield_completed_notice,
    )
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
