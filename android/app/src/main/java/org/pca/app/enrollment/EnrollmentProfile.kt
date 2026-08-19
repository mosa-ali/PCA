package org.pca.app.enrollment

import kotlin.time.Duration.Companion.minutes
import org.pca.app.feature.screentime.engine.ScreenTimeConfig

/** Controlled enrollment values shared by bootstrap parsing, encrypted local state, and runtime composition. */
enum class AgeUxTier { YOUNG_CHILD, TEEN }

enum class InitialPolicyProfile { BALANCED, STRICT }

/** The real Safe Browser default vocabulary already supported by the Android policy layer. */
enum class ContentFilterDefault { MODERATE, STRICT }

/**
 * Owner-configurable enrollment defaults. The baseline keeps the existing
 * 60/30 safety floor; stricter age/profile values may be supplied without
 * changing the enrollment protocol or weakening a child device.
 */
data class EnrollmentDefaultsConfiguration(
    val balancedActiveThresholdMinutes: Int = 60,
    val strictActiveThresholdMinutes: Int = 45,
    val balancedBreakDurationMinutes: Int = 30,
    val strictBreakDurationMinutes: Int = 30,
) {
    fun isBaselineCompliant(): Boolean =
        balancedActiveThresholdMinutes in 15..60 &&
            strictActiveThresholdMinutes in 15..60 &&
            strictActiveThresholdMinutes <= balancedActiveThresholdMinutes &&
            balancedBreakDurationMinutes in 30..120 &&
            strictBreakDurationMinutes in 30..120 &&
            strictBreakDurationMinutes >= balancedBreakDurationMinutes

    fun sanitized(): EnrollmentDefaultsConfiguration =
        if (isBaselineCompliant()) this else BASELINE

    companion object {
        val BASELINE = EnrollmentDefaultsConfiguration()
    }
}

/** Initial defaults are always baseline-compliant; later signed policy delivery remains authoritative. */
fun screenTimeConfigForEnrollmentProfile(
    ageUxTier: AgeUxTier,
    initialPolicyProfile: InitialPolicyProfile,
    configuration: EnrollmentDefaultsConfiguration = EnrollmentDefaultsConfiguration.BASELINE,
): ScreenTimeConfig {
    val safeConfiguration = configuration.sanitized()
    val stricterAgeDefault = ageUxTier == AgeUxTier.YOUNG_CHILD
    val strict = initialPolicyProfile == InitialPolicyProfile.STRICT || stricterAgeDefault
    val activeMinutes = if (strict) {
        safeConfiguration.strictActiveThresholdMinutes
    } else {
        safeConfiguration.balancedActiveThresholdMinutes
    }
    val breakMinutes = if (strict) {
        safeConfiguration.strictBreakDurationMinutes
    } else {
        safeConfiguration.balancedBreakDurationMinutes
    }
    return ScreenTimeConfig(activeThreshold = activeMinutes.minutes, breakDuration = breakMinutes.minutes)
}

/** Age/profile defaults are only a minimum; a stricter parent policy wins. */
fun contentFilterDefaultForEnrollmentProfile(
    ageUxTier: AgeUxTier,
    initialPolicyProfile: InitialPolicyProfile,
): ContentFilterDefault =
    if (ageUxTier == AgeUxTier.YOUNG_CHILD || initialPolicyProfile == InitialPolicyProfile.STRICT) {
        ContentFilterDefault.STRICT
    } else {
        ContentFilterDefault.MODERATE
    }
