package org.pca.app.accessibility

import android.provider.Settings
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext

/**
 * doc 26 Section 3: "Respect dynamic type/font scaling... display zoom without clipping...
 * Animation honors reduced-motion settings... Contrast... reviewed against the current platform
 * accessibility guidance." This object holds the PURE decision logic (testable on a plain JVM,
 * no Robolectric/instrumentation needed) separately from the thin `@Composable` readers below
 * that supply real system values -- mirroring this codebase's existing i18n/BidiUtils split
 * between pure logic and platform wiring.
 *
 * Contrast: no dynamic high-text-contrast API is wired here -- `AccessibilityManager`'s
 * high-contrast query is not part of the public SDK surface at this project's compileSdk, so a
 * dynamic hook was deliberately NOT added rather than guessed at with a fragile/hidden API call.
 * Contrast currently relies on Material3's default color scheme, which meets baseline WCAG AA
 * contrast out of the box; a reviewed, deliberate high-contrast palette is follow-up scope, not
 * silently claimed as done here.
 */
object AccessibilityPreferences {
    /** doc 26 Section 3: "flashing/rapid effects are avoided" / doc 20 Section 6/9: honor the system's reduced-motion (Settings > Accessibility > Remove animations) preference. `0f` is Android's own convention for "animations disabled" (Settings.Global.ANIMATOR_DURATION_SCALE). */
    fun isReducedMotionEnabled(animatorDurationScale: Float): Boolean = animatorDurationScale == 0f

    /**
     * doc 26 Section 3: "large text/Dynamic Type/font scaling... without clipping, overlap, loss
     * of controls." Floors at 1.0 (never renders SMALLER than the app's own baseline -- a
     * below-default system font scale must not be used to shrink already-small child-facing text
     * further) and caps growth at [maxScale] so layouts do not break entirely at extreme settings;
     * any screen approaching this cap still needs its own scroll/reflow handling, which this
     * function cannot provide by itself.
     */
    fun clampFontScale(systemFontScale: Float, maxScale: Float = 2.0f): Float =
        systemFontScale.coerceIn(1.0f, maxScale)
}

@Composable
fun rememberReducedMotionEnabled(): Boolean {
    val context = LocalContext.current
    val scale = remember(context) {
        Settings.Global.getFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f)
    }
    return AccessibilityPreferences.isReducedMotionEnabled(scale)
}

@Composable
fun rememberClampedFontScale(maxScale: Float = 2.0f): Float {
    val systemFontScale = LocalConfiguration.current.fontScale
    return AccessibilityPreferences.clampFontScale(systemFontScale, maxScale)
}
