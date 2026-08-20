package org.pca.app.feature.breakshield

import androidx.compose.animation.core.tween
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import org.pca.app.PcaApplication
import org.pca.app.R
import org.pca.app.accessibility.rememberClampedFontScale
import org.pca.app.accessibility.rememberReducedMotionEnabled
import org.pca.app.enrollment.AgeUxTier
import org.pca.app.enrollment.ReadingLevel
import org.pca.app.enrollment.readingLevel
import java.util.Locale
import kotlin.time.Duration

/**
 * Full-screen, always-transparent Break Shield: what the child sees is exactly the derived
 * [BreakShieldViewState] — remaining time, the dhikr interaction, and the two explicit,
 * visible affordances (parent override, emergency exception). There is no enforcement path
 * that bypasses this screen silently.
 *
 * PCA-16: every visible string is resource-driven (doc 20 Section 2 -- no hard-coded product
 * text, no concatenated translated fragments); the countdown and interaction count use a
 * `liveRegion` so a screen reader announces updates (doc 20 Section 6); the Emergency and
 * "Ask a parent" affordances remain in a `Row` whose main-axis order Compose already mirrors
 * for RTL locales automatically (doc 20 Section 3/lane brief Section 11: emergency access must
 * never be hidden by layout).
 *
 * PCA-16A correction (accessibility secondary finding): the screen's only animation -- a brief
 * fade-in on first composition, purely decorative/non-essential -- honors the system reduced-
 * motion preference (see [breakShieldFadeInDurationMillis]) by collapsing to an instant
 * (0ms) appearance instead of a 300ms fade. Text is rendered under a font-scale-clamped
 * [LocalDensity] (see [AccessibilityPreferences.clampFontScale]) so large-text users get bigger
 * text without the layout breaking at extreme system scales. Neither of these touches
 * [BreakShieldViewState]/[BreakShieldController] -- the underlying PCA-3 timer/break semantics
 * (remaining time, dhikr count, mode transitions) are computed exactly as before; only how this
 * screen PRESENTS that already-computed state is affected.
 */
@Composable
fun BreakShieldScreen(
    state: BreakShieldViewState,
    onDhikrInteraction: () -> Unit,
    onRequestParentOverride: () -> Unit,
    onRequestEmergencyException: () -> Unit,
    ageUxTier: AgeUxTier? = null,
    onCallEmergencyServices: () -> Unit = run {
        val context = LocalContext.current
        { launchEmergencyDialer(context) }
    },
) {
    if (!state.isShieldVisible) return

    val locale = LocalConfiguration.current.locales[0]
    val remainingBreakText = formatDuration(state.remainingBreak, locale)

    // PCA-NFR-044: the real, currently-enrolled age tier is read from the same persisted
    // FamilyStateStore the rest of the runtime graph already uses -- never a hardcoded default --
    // mirroring ChildHomeScreen.kt's resolveDeviceAgeUxTier(). A caller may still pass
    // [ageUxTier] explicitly (previews/tests); when omitted the real device state is resolved
    // here.
    val resolvedAgeUxTier = ageUxTier ?: resolveDeviceAgeUxTier()
    val copy = breakShieldCopyForTier(resolvedAgeUxTier)

    // Resolved here, inside the @Composable scope, since Modifier.semantics {} below is a plain
    // (non-composable) lambda and cannot itself call stringResource().
    val remainingTimeA11y = stringResource(R.string.break_shield_remaining_time_a11y, remainingBreakText)
    val dhikrButtonHint = stringResource(R.string.dhikr_button_hint)
    val askParentButtonHint = stringResource(R.string.ask_parent_button_hint)
    val emergencyButtonHint = stringResource(R.string.emergency_button_hint)
    val emergencyCallButtonHint = stringResource(R.string.emergency_call_button_hint)

    val reducedMotion = rememberReducedMotionEnabled()
    var visible by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { visible = true }
    val alpha by animateFloatAsState(
        targetValue = if (visible) 1f else 0f,
        animationSpec = tween(durationMillis = breakShieldFadeInDurationMillis(reducedMotion)),
        label = "breakShieldFadeIn",
    )

    val clampedFontScale = rememberClampedFontScale()
    val baseDensity = LocalDensity.current

    CompositionLocalProvider(LocalDensity provides Density(baseDensity.density, clampedFontScale)) {
        MaterialTheme {
            Surface(modifier = Modifier.fillMaxSize().alpha(alpha)) {
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
                        text = stringResource(copy.explanationRes),
                        style = MaterialTheme.typography.bodyMedium,
                    )
                    Text(
                        text = stringResource(R.string.break_shield_remaining_time, remainingBreakText),
                        style = MaterialTheme.typography.bodyLarge,
                        modifier = Modifier.semantics {
                            liveRegion = LiveRegionMode.Polite
                            contentDescription = remainingTimeA11y
                        },
                    )
                    Text(
                        text = pluralStringResource(
                            R.plurals.dhikr_interaction_count,
                            state.dhikrInteractionCount,
                            state.dhikrInteractionCount,
                        ),
                        style = MaterialTheme.typography.bodyMedium,
                        modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
                    )
                    if (state.canInteractWithDhikr) {
                        Button(
                            onClick = onDhikrInteraction,
                            modifier = Modifier.semantics { contentDescription = dhikrButtonHint },
                        ) { Text(stringResource(copy.dhikrButtonRes)) }
                    }
                    Row {
                        if (state.canRequestParentOverride) {
                            Button(
                                onClick = onRequestParentOverride,
                                modifier = Modifier.semantics { contentDescription = askParentButtonHint },
                            ) { Text(stringResource(copy.askParentButtonRes)) }
                        }
                        if (state.canRequestEmergencyException) {
                            // Emergency remains visible/reachable regardless of RTL layout, large text,
                            // reduced motion, or any other condition above (lane brief Section 11) -- it
                            // is never conditionally hidden by anything other than the
                            // emergency-exception state itself (see
                            // BreakShieldViewState.canRequestEmergencyException). It is inside the same
                            // fade-in as the rest of the screen, but that fade is at most 300ms and
                            // collapses to instant under reduced motion -- it is never delayed, gated, or
                            // suppressed independently.
                            Button(
                                onClick = onRequestEmergencyException,
                                modifier = Modifier.semantics { contentDescription = emergencyButtonHint },
                            ) { Text(stringResource(copy.emergencyButtonRes)) }
                        }
                        // PCA-FR-132: a real "call for help" action, always present -- unlike the
                        // emergency-EXCEPTION button above (which only bypasses PCA's own screen-time
                        // policy and is hidden while that exception is already active), reaching a
                        // phone must never depend on any Break Shield mode/state. See
                        // EmergencyDialIntent.kt's own doc comment for why this is ACTION_DIAL, never
                        // ACTION_CALL, and why no number is pre-filled.
                        Button(
                            onClick = onCallEmergencyServices,
                            modifier = Modifier.semantics { contentDescription = emergencyCallButtonHint },
                        ) { Text(stringResource(copy.emergencyCallButtonRes)) }
                    }
                }
            }
        }
    }
}

/** doc 26 Section 3: "Animation honors reduced-motion settings." Pure and JVM-testable, mirroring this file's existing formatDuration pattern -- the real screen builds its `tween` directly from this function's result, so testing it IS testing the real presentation behavior, not a parallel/unused helper. */
internal fun breakShieldFadeInDurationMillis(reducedMotion: Boolean): Int = if (reducedMotion) 0 else 300

/**
 * PCA-NFR-044: resolves the real, persisted [AgeUxTier] for this device from the same composition
 * root ([PcaApplication.graph]) the rest of the runtime already uses, mirroring
 * [org.pca.app.runtime.ui.ChildHomeScreen]'s `resolveDeviceAgeUxTier()`. Falls back to
 * [AgeUxTier.YOUNG_CHILD] (the stricter tier) only when no enrolled family state exists yet or
 * the hosting context isn't [PcaApplication] (e.g. a Preview/test harness).
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
 * PCA-NFR-044: reading-level string set for the Break Shield surface, mirroring
 * [org.pca.app.enrollment.ui.EnrollmentScreen]'s `EnrollmentDisclosureCopy`/`disclosureCopyForTier`
 * pattern. Only wording complexity changes between tiers -- the underlying safety substance (the
 * break pauses/resumes automatically, a parent can be asked, emergency access always remains
 * available) is identical in both variants.
 */
private data class BreakShieldCopy(
    val readingLevel: ReadingLevel,
    @androidx.annotation.StringRes val titleRes: Int,
    @androidx.annotation.StringRes val explanationRes: Int,
    @androidx.annotation.StringRes val dhikrButtonRes: Int,
    @androidx.annotation.StringRes val askParentButtonRes: Int,
    @androidx.annotation.StringRes val emergencyButtonRes: Int,
    @androidx.annotation.StringRes val emergencyCallButtonRes: Int,
)

private fun breakShieldCopyForTier(ageUxTier: AgeUxTier): BreakShieldCopy = when (ageUxTier) {
    AgeUxTier.YOUNG_CHILD -> BreakShieldCopy(
        readingLevel = ageUxTier.readingLevel,
        titleRes = R.string.break_shield_title,
        explanationRes = R.string.break_shield_explanation_simple,
        dhikrButtonRes = R.string.dhikr_button_label_simple,
        askParentButtonRes = R.string.ask_parent_button_label_simple,
        emergencyButtonRes = R.string.emergency_button_label_simple,
        emergencyCallButtonRes = R.string.emergency_call_button_label_simple,
    )
    AgeUxTier.TEEN -> BreakShieldCopy(
        readingLevel = ageUxTier.readingLevel,
        titleRes = R.string.break_shield_title,
        explanationRes = R.string.break_shield_explanation,
        dhikrButtonRes = R.string.dhikr_button_label,
        askParentButtonRes = R.string.ask_parent_button_label,
        emergencyButtonRes = R.string.emergency_button_label,
        emergencyCallButtonRes = R.string.emergency_call_button_label,
    )
}

/**
 * doc 20 Section 4: "Present ... Arabic-Indic versus Latin digits ... using the device locale/
 * preference where supported." `String.format(locale, ...)` honors the locale's own decimal
 * digit symbols for `%d`, so an Arabic-locale device renders Arabic-Indic digits here
 * automatically -- this is a deliberate, tested choice (see BreakShieldFormatDurationTest), not
 * an oversight. The underlying `Duration` value/calculation is untouched by locale (doc 20
 * Section 4: "A number-shape preference must not change parsed values... policy calculations").
 */
internal fun formatDuration(duration: Duration, locale: Locale = Locale.getDefault()): String {
    val totalSeconds = duration.inWholeSeconds.coerceAtLeast(0)
    val minutes = totalSeconds / 60
    val seconds = totalSeconds % 60
    return String.format(locale, "%02d:%02d", minutes, seconds)
}

@Preview(showBackground = true)
@Composable
private fun BreakShieldScreenPreview() {
    BreakShieldScreen(
        state = BreakShieldViewState(
            isShieldVisible = true,
            remainingBreak = kotlin.time.Duration.parse("PT18M30S"),
            dhikrInteractionCount = 3,
            canInteractWithDhikr = true,
            canRequestParentOverride = true,
            canRequestEmergencyException = true,
            remainingActiveBeforeBreak = Duration.ZERO,
            completedBreakCount = 2,
            isCommunicationExceptionActive = false,
            overriddenBreakCount = 0,
            isEmergencyExceptionActive = false,
        ),
        onDhikrInteraction = {},
        onRequestParentOverride = {},
        onRequestEmergencyException = {},
    )
}
