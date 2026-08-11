package org.pca.app.accessibility

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AccessibilityPreferencesTest {
    @Test
    fun `reduced motion is detected only when the animator duration scale is exactly zero`() {
        assertTrue(AccessibilityPreferences.isReducedMotionEnabled(0f))
        assertFalse(AccessibilityPreferences.isReducedMotionEnabled(1f))
        assertFalse(AccessibilityPreferences.isReducedMotionEnabled(0.5f))
    }

    @Test
    fun `font scale is never shrunk below the system-requested value`() {
        assertEquals(1.5f, AccessibilityPreferences.clampFontScale(1.5f), 0.001f)
        assertEquals(1.0f, AccessibilityPreferences.clampFontScale(1.0f), 0.001f)
    }

    @Test
    fun `font scale is capped at the maximum to keep layouts usable`() {
        assertEquals(2.0f, AccessibilityPreferences.clampFontScale(3.5f, maxScale = 2.0f), 0.001f)
    }

    @Test
    fun `font scale below the system default floor of 1_0 is still floored at 1_0`() {
        // A malformed/negative system value must never produce a shrink-below-default result.
        assertEquals(1.0f, AccessibilityPreferences.clampFontScale(0.3f), 0.001f)
    }
}
