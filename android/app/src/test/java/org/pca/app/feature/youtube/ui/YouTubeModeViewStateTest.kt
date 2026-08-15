package org.pca.app.feature.youtube.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.pca.app.feature.youtube.policy.ModeAUsageEvidence
import org.pca.app.feature.youtube.policy.ModeBFeatureFlagState
import org.pca.app.feature.youtube.policy.UsageCapabilityStatus
import org.pca.app.feature.youtube.policy.UsageSource
import org.pca.app.feature.youtube.policy.YouTubeMode

/**
 * PCA-FR-054: [YouTubeModeViewStateBuilder] always reports [YouTubeMode.A] as current and never
 * reports Mode B as available unless the underlying feature flag is genuinely active (mirroring
 * [org.pca.app.feature.youtube.policy.isModeBActive] exactly, never a looser local approximation)
 * -- this is the test proving the screen cannot be tricked into showing Mode B as reachable.
 */
class YouTubeModeViewStateTest {

    private fun evidence(status: UsageCapabilityStatus, durationMs: Long?) = ModeAUsageEvidence(
        familyId = "family-1",
        profileId = "profile-1",
        source = if (status == UsageCapabilityStatus.UNSUPPORTED) UsageSource.UNAVAILABLE else UsageSource.ANDROID_USAGE_STATS,
        capabilityStatus = status,
        durationMs = durationMs,
        coverageGap = false,
        observedAtEpochMillis = 1000L,
    )

    @Test
    fun `current mode is always A, regardless of the Mode B flag state`() {
        val stateWithFlagOn = YouTubeModeViewStateBuilder.build(null, ModeBFeatureFlagState(enabled = true, termsReviewedAtEpochMillis = 1000L))
        assertEquals(YouTubeMode.A, stateWithFlagOn.currentMode)
    }

    @Test
    fun `Mode B is unavailable by default -- no flag, no terms review`() {
        val state = YouTubeModeViewStateBuilder.build(null, ModeBFeatureFlagState(enabled = false, termsReviewedAtEpochMillis = null))
        assertFalse(state.isModeBAvailable)
    }

    @Test
    fun `Mode B stays unavailable if only enabled is true without a recorded terms review`() {
        val state = YouTubeModeViewStateBuilder.build(null, ModeBFeatureFlagState(enabled = true, termsReviewedAtEpochMillis = null))
        assertFalse(state.isModeBAvailable)
    }

    @Test
    fun `Mode B stays unavailable if only a terms review is recorded without enabled`() {
        val state = YouTubeModeViewStateBuilder.build(null, ModeBFeatureFlagState(enabled = false, termsReviewedAtEpochMillis = 1000L))
        assertFalse(state.isModeBAvailable)
    }

    @Test
    fun `Mode B is available only once both enabled and a terms review are present`() {
        val state = YouTubeModeViewStateBuilder.build(null, ModeBFeatureFlagState(enabled = true, termsReviewedAtEpochMillis = 1000L))
        assertTrue(state.isModeBAvailable)
    }

    @Test
    fun `hasMeasuredUsage is false when evidence is null -- never treated as zero usage`() {
        val state = YouTubeModeViewStateBuilder.build(null, ModeBFeatureFlagState(false, null))
        assertFalse(state.hasMeasuredUsage())
    }

    @Test
    fun `hasMeasuredUsage is false when capability is REVOKED even if a stale duration is present`() {
        val state = YouTubeModeViewStateBuilder.build(evidence(UsageCapabilityStatus.REVOKED, null), ModeBFeatureFlagState(false, null))
        assertFalse(state.hasMeasuredUsage())
    }

    @Test
    fun `hasMeasuredUsage is true only when capability is GRANTED and a duration is present`() {
        val state = YouTubeModeViewStateBuilder.build(evidence(UsageCapabilityStatus.GRANTED, 42_000L), ModeBFeatureFlagState(false, null))
        assertTrue(state.hasMeasuredUsage())
    }
}
