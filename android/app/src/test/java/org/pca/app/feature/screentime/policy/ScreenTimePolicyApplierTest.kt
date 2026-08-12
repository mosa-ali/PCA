package org.pca.app.feature.screentime.policy

import kotlin.time.Duration.Companion.minutes
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.pca.app.feature.screentime.engine.ScreenTimeConfig

/**
 * PCA-SCREEN-BASELINE-1: the Android policy-application path must never silently apply a
 * weaker-than-60/30 incoming or stored policy. An invalid policy is rejected as a whole (not
 * "fixed in place"), the last-known-good config is preserved, and the rejection is surfaced as a
 * distinct, explicit status rather than a bare unchanged value a caller could mistake for success.
 */
class ScreenTimePolicyApplierTest {

    private val lastKnownGood = ScreenTimeConfig(activeThreshold = 60.minutes, breakDuration = 30.minutes)

    @Test
    fun `exact baseline 60-30 is applied`() {
        val result = ScreenTimePolicyApplier.apply(
            ScreenTimePolicyPayload(continuousUseLimitMinutes = 60, breakDurationMinutes = 30),
            lastKnownGood,
        )
        assertEquals(ScreenTimePolicyApplicationStatus.APPLIED, result.status)
        assertTrue(result is ScreenTimePolicyApplicationResult.Applied)
        assertEquals(60.minutes, result.effectiveConfig.activeThreshold)
        assertEquals(30.minutes, result.effectiveConfig.breakDuration)
    }

    @Test
    fun `stricter 45-30 is applied`() {
        val result = ScreenTimePolicyApplier.apply(
            ScreenTimePolicyPayload(continuousUseLimitMinutes = 45, breakDurationMinutes = 30),
            lastKnownGood,
        )
        assertEquals(ScreenTimePolicyApplicationStatus.APPLIED, result.status)
        assertEquals(45.minutes, result.effectiveConfig.activeThreshold)
    }

    @Test
    fun `stricter 30-45 is applied`() {
        val result = ScreenTimePolicyApplier.apply(
            ScreenTimePolicyPayload(continuousUseLimitMinutes = 30, breakDurationMinutes = 45),
            lastKnownGood,
        )
        assertEquals(ScreenTimePolicyApplicationStatus.APPLIED, result.status)
        assertEquals(45.minutes, result.effectiveConfig.breakDuration)
    }

    @Test
    fun `stricter 60-90 is applied`() {
        val result = ScreenTimePolicyApplier.apply(
            ScreenTimePolicyPayload(continuousUseLimitMinutes = 60, breakDurationMinutes = 90),
            lastKnownGood,
        )
        assertEquals(ScreenTimePolicyApplicationStatus.APPLIED, result.status)
        assertEquals(90.minutes, result.effectiveConfig.breakDuration)
    }

    @Test
    fun `61-30 is rejected and the last-known-good 60-30 config is preserved`() {
        val result = ScreenTimePolicyApplier.apply(
            ScreenTimePolicyPayload(continuousUseLimitMinutes = 61, breakDurationMinutes = 30),
            lastKnownGood,
        )
        assertEquals(ScreenTimePolicyApplicationStatus.INVALID_POLICY_BASELINE, result.status)
        assertTrue(result is ScreenTimePolicyApplicationResult.RejectedInvalidBaseline)
        assertEquals(lastKnownGood, result.effectiveConfig)
    }

    @Test
    fun `60-29 is rejected and the last-known-good config is preserved`() {
        val result = ScreenTimePolicyApplier.apply(
            ScreenTimePolicyPayload(continuousUseLimitMinutes = 60, breakDurationMinutes = 29),
            lastKnownGood,
        )
        assertEquals(ScreenTimePolicyApplicationStatus.INVALID_POLICY_BASELINE, result.status)
        assertEquals(lastKnownGood, result.effectiveConfig)
    }

    @Test
    fun `grossly weakened 180-5 is rejected and the last-known-good config is preserved`() {
        val result = ScreenTimePolicyApplier.apply(
            ScreenTimePolicyPayload(continuousUseLimitMinutes = 180, breakDurationMinutes = 5),
            lastKnownGood,
        )
        assertEquals(ScreenTimePolicyApplicationStatus.INVALID_POLICY_BASELINE, result.status)
        assertEquals(lastKnownGood, result.effectiveConfig)
    }

    @Test
    fun `a rejected policy's fields are never adopted -- the effective config is exactly the prior one, not a clamped version`() {
        val result = ScreenTimePolicyApplier.apply(
            ScreenTimePolicyPayload(continuousUseLimitMinutes = 180, breakDurationMinutes = 5),
            lastKnownGood,
        )
        // The rejected payload's own (illegal) values must never leak into effectiveConfig, e.g.
        // via clamping to 60/30 which would coincidentally look plausible -- assert the *exact*
        // prior object identity/values are what remains in effect.
        assertEquals(lastKnownGood.activeThreshold, result.effectiveConfig.activeThreshold)
        assertEquals(lastKnownGood.breakDuration, result.effectiveConfig.breakDuration)
        val rejected = result as ScreenTimePolicyApplicationResult.RejectedInvalidBaseline
        assertEquals(180, rejected.rejectedPayload.continuousUseLimitMinutes)
        assertEquals(5, rejected.rejectedPayload.breakDurationMinutes)
    }

    @Test
    fun `a stricter prior policy is preserved on rejection, not silently loosened back to 60-30`() {
        val stricterLastKnownGood = ScreenTimeConfig(activeThreshold = 45.minutes, breakDuration = 40.minutes)
        val result = ScreenTimePolicyApplier.apply(
            ScreenTimePolicyPayload(continuousUseLimitMinutes = 90, breakDurationMinutes = 30),
            stricterLastKnownGood,
        )
        assertEquals(ScreenTimePolicyApplicationStatus.INVALID_POLICY_BASELINE, result.status)
        assertEquals(stricterLastKnownGood, result.effectiveConfig)
    }

    @Test
    fun `legacy stored policy predating the baseline is rejected, not silently applied`() {
        // Simulates decoding an old locally-persisted or demo/fixture policy record authored
        // before PCA-SCREEN-BASELINE-1 existed.
        val legacyWeakPolicy = ScreenTimePolicyPayload(continuousUseLimitMinutes = 90, breakDurationMinutes = 15)
        val result = ScreenTimePolicyApplier.apply(legacyWeakPolicy, ScreenTimePolicyApplier.SAFE_DEFAULT_CONFIG)

        assertEquals(ScreenTimePolicyApplicationStatus.INVALID_POLICY_BASELINE, result.status)
        // The safe 60/30 default remains in effect -- never the legacy 90/15 values.
        assertEquals(60.minutes, result.effectiveConfig.activeThreshold)
        assertEquals(30.minutes, result.effectiveConfig.breakDuration)
    }

    @Test
    fun `default last-known-good is the safe 60-30 baseline itself, which is compliant`() {
        assertTrue(ScreenTimeBaselinePolicy.isBaselineCompliant(ScreenTimePolicyApplier.SAFE_DEFAULT_CONFIG))
    }

    @Test
    fun `applying with no explicit last-known-good falls back to the safe default on rejection`() {
        val result = ScreenTimePolicyApplier.apply(
            ScreenTimePolicyPayload(continuousUseLimitMinutes = 180, breakDurationMinutes = 5),
        )
        assertEquals(ScreenTimePolicyApplicationStatus.INVALID_POLICY_BASELINE, result.status)
        assertEquals(ScreenTimePolicyApplier.SAFE_DEFAULT_CONFIG, result.effectiveConfig)
    }

    @Test
    fun `policy application is a pure function -- repeated calls with the same input are deterministic`() {
        val payload = ScreenTimePolicyPayload(continuousUseLimitMinutes = 45, breakDurationMinutes = 35)
        val first = ScreenTimePolicyApplier.apply(payload, lastKnownGood)
        val second = ScreenTimePolicyApplier.apply(payload, lastKnownGood)
        assertEquals(first, second)
    }
}
