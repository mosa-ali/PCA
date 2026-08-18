package org.pca.app.enrollment

import org.junit.Assert.assertEquals
import org.junit.Test

class EnrollmentContentFilterDefaultTest {
    @Test
    fun `young child always receives strict minimum`() {
        assertEquals(
            ContentFilterDefault.STRICT,
            contentFilterDefaultForEnrollmentProfile(AgeUxTier.YOUNG_CHILD, InitialPolicyProfile.BALANCED),
        )
    }

    @Test
    fun `teen balanced receives moderate minimum`() {
        assertEquals(
            ContentFilterDefault.MODERATE,
            contentFilterDefaultForEnrollmentProfile(AgeUxTier.TEEN, InitialPolicyProfile.BALANCED),
        )
    }

    @Test
    fun `strict profile cannot be weakened by teen age tier`() {
        assertEquals(
            ContentFilterDefault.STRICT,
            contentFilterDefaultForEnrollmentProfile(AgeUxTier.TEEN, InitialPolicyProfile.STRICT),
        )
    }
}
