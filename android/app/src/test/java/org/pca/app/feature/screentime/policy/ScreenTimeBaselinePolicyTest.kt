package org.pca.app.feature.screentime.policy

import kotlin.time.Duration.Companion.minutes
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.pca.app.feature.screentime.engine.ScreenTimeConfig

/** PCA-SCREEN-BASELINE-1: the non-weakenable 60/30 anti-gaming baseline must never be
 * configurable to something weaker on the Android side. */
class ScreenTimeBaselinePolicyTest {

    @Test
    fun `exact baseline 60-30 is compliant`() {
        assertTrue(ScreenTimeBaselinePolicy.isBaselineCompliant(60.minutes, 30.minutes))
    }

    @Test
    fun `stricter continuous-use limit 45-30 is compliant`() {
        assertTrue(ScreenTimeBaselinePolicy.isBaselineCompliant(45.minutes, 30.minutes))
    }

    @Test
    fun `stricter break duration 30-45 is compliant`() {
        assertTrue(ScreenTimeBaselinePolicy.isBaselineCompliant(30.minutes, 45.minutes))
    }

    @Test
    fun `stricter break duration 60-90 is compliant`() {
        assertTrue(ScreenTimeBaselinePolicy.isBaselineCompliant(60.minutes, 90.minutes))
    }

    @Test
    fun `continuous-use limit of 61 minutes -- one over the ceiling -- is rejected`() {
        assertFalse(ScreenTimeBaselinePolicy.isBaselineCompliant(61.minutes, 30.minutes))
    }

    @Test
    fun `break duration of 29 minutes -- one under the floor -- is rejected`() {
        assertFalse(ScreenTimeBaselinePolicy.isBaselineCompliant(60.minutes, 29.minutes))
    }

    @Test
    fun `grossly weakened 180-5 is rejected`() {
        assertFalse(ScreenTimeBaselinePolicy.isBaselineCompliant(180.minutes, 5.minutes))
    }

    @Test
    fun `the hardcoded ScreenTimeConfig default is itself baseline-compliant`() {
        assertTrue(ScreenTimeBaselinePolicy.isBaselineCompliant(ScreenTimeConfig()))
    }

    @Test
    fun `overload accepting a ScreenTimeConfig agrees with the Duration overload`() {
        val config = ScreenTimeConfig(activeThreshold = 45.minutes, breakDuration = 30.minutes)
        assertTrue(ScreenTimeBaselinePolicy.isBaselineCompliant(config))
        assertTrue(ScreenTimeBaselinePolicy.isBaselineCompliant(config.activeThreshold, config.breakDuration))
    }

    @Test
    fun `continuous-use limit below the pre-existing supported minimum is rejected`() {
        assertFalse(ScreenTimeBaselinePolicy.isBaselineCompliant(14.minutes, 30.minutes))
    }

    @Test
    fun `break duration above the documented sane ceiling is rejected`() {
        assertFalse(ScreenTimeBaselinePolicy.isBaselineCompliant(60.minutes, 121.minutes))
    }
}
