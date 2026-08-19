package org.pca.app.enrollment

import org.junit.Assert.assertEquals
import org.junit.Test

class EnrollmentProfileContractTest {
    @Test
    fun `strict and young child defaults remain baseline compliant`() {
        val config = screenTimeConfigForEnrollmentProfile(AgeUxTier.YOUNG_CHILD, InitialPolicyProfile.STRICT)
        assertEquals(45, config.activeThreshold.inWholeMinutes)
        assertEquals(30, config.breakDuration.inWholeMinutes)
    }

    @Test
    fun `configured stricter tier break remains reachable without weakening teen baseline`() {
        val configuration = EnrollmentDefaultsConfiguration(
            balancedBreakDurationMinutes = 30,
            strictBreakDurationMinutes = 45,
        )

        val teenBalanced = screenTimeConfigForEnrollmentProfile(
            AgeUxTier.TEEN,
            InitialPolicyProfile.BALANCED,
            configuration,
        )
        val youngChild = screenTimeConfigForEnrollmentProfile(
            AgeUxTier.YOUNG_CHILD,
            InitialPolicyProfile.BALANCED,
            configuration,
        )

        assertEquals(30, teenBalanced.breakDuration.inWholeMinutes)
        assertEquals(45, youngChild.breakDuration.inWholeMinutes)
    }

    @Test
    fun `unsafe configuration fails closed to baseline`() {
        val unsafe = EnrollmentDefaultsConfiguration(
            balancedActiveThresholdMinutes = 90,
            strictActiveThresholdMinutes = 60,
            balancedBreakDurationMinutes = 15,
            strictBreakDurationMinutes = 15,
        )

        val config = screenTimeConfigForEnrollmentProfile(
            AgeUxTier.TEEN,
            InitialPolicyProfile.BALANCED,
            unsafe,
        )

        assertEquals(60, config.activeThreshold.inWholeMinutes)
        assertEquals(30, config.breakDuration.inWholeMinutes)
    }
}
