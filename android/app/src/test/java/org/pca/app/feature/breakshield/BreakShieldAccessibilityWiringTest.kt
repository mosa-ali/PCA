package org.pca.app.feature.breakshield

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * PCA-16A correction, accessibility secondary finding: proves the exact function
 * `BreakShieldScreen` calls to build its fade-in `tween(durationMillis = ...)` actually changes
 * behavior under reduced motion -- not a parallel/unused helper (see
 * `org.pca.app.accessibility.AccessibilityPreferences` for the underlying system-signal
 * detection, already covered by `AccessibilityPreferencesTest`).
 */
class BreakShieldAccessibilityWiringTest {
    @Test
    fun `reduced motion collapses the Break Shield fade-in to an instant (0ms) appearance`() {
        assertEquals(0, breakShieldFadeInDurationMillis(reducedMotion = true))
    }

    @Test
    fun `without reduced motion, the Break Shield still fades in over a short, non-zero duration`() {
        val duration = breakShieldFadeInDurationMillis(reducedMotion = false)
        assertEquals(300, duration)
        assert(duration in 1..500) { "fade-in duration should be a short, non-jarring transition" }
    }
}
