package org.pca.app.enrollment

import kotlin.time.Duration.Companion.minutes
import org.pca.app.feature.screentime.engine.ScreenTimeConfig

/** Controlled enrollment values shared by bootstrap parsing, encrypted local state, and runtime composition. */
enum class AgeUxTier { YOUNG_CHILD, TEEN }

enum class InitialPolicyProfile { BALANCED, STRICT }

/** Initial defaults are always baseline-compliant; later signed policy delivery remains authoritative. */
fun screenTimeConfigForEnrollmentProfile(
    ageUxTier: AgeUxTier,
    initialPolicyProfile: InitialPolicyProfile,
): ScreenTimeConfig {
    val stricterAgeDefault = ageUxTier == AgeUxTier.YOUNG_CHILD
    val activeMinutes = if (initialPolicyProfile == InitialPolicyProfile.STRICT || stricterAgeDefault) 45 else 60
    return ScreenTimeConfig(activeThreshold = activeMinutes.minutes, breakDuration = 30.minutes)
}
