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
}
