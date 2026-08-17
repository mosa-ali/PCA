package org.pca.app.enrollment

import java.io.File
import org.junit.Assert.assertTrue
import org.junit.Test

class EnrollmentConsentStaticTest {
    @Test
    fun `invitation-ready enrollment is gated by the informed-consent summary`() {
        val candidates = listOf(
            File("src/main/java/org/pca/app/enrollment/ui/EnrollmentScreen.kt"),
            File("app/src/main/java/org/pca/app/enrollment/ui/EnrollmentScreen.kt"),
        )
        val source = candidates.firstOrNull { it.exists() }?.readText()
            ?: error("EnrollmentScreen.kt was not found")
        assertTrue(source.contains("is EnrollmentState.InvitationReady"))
        assertTrue(source.contains("InformedConsentStep(onAccept = onContinue)"))
        assertTrue(source.contains("enrollment_consent_monitored_heading"))
        assertTrue(source.contains("enrollment_consent_not_monitored_heading"))
        assertTrue(source.contains("enrollment_consent_accept_button"))
    }
}
