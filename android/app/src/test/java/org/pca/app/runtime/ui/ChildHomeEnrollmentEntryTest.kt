package org.pca.app.runtime.ui

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.pca.app.enrollment.AgeUxTier
import org.pca.app.enrollment.InitialPolicyProfile
import org.pca.app.enrollment.EnrollmentState

class ChildHomeEnrollmentEntryTest {
    @Test
    fun `fresh and unresolved setup states expose the launcher entry`() {
        val actionableStates = listOf(
            EnrollmentState.NotEnrolled,
            EnrollmentState.InvitationReady("https://api.pcasafe.com"),
            EnrollmentState.ProfileConfirmation(
                deviceId = "device-1",
                ageUxTier = AgeUxTier.TEEN,
                initialPolicyProfile = InitialPolicyProfile.BALANCED,
            ),
            EnrollmentState.FailedRetryable,
            EnrollmentState.BootstrapResultUnknown,
            EnrollmentState.RecoveryPending("https://api.pcasafe.com"),
        )

        actionableStates.forEach { state -> assertTrue(state.toString(), shouldShowEnrollmentEntry(state)) }
    }

    @Test
    fun `blocked and non-actionable states do not show the enrollment entry`() {
        val blockedStates = listOf(
            EnrollmentState.LocalStateCorrupt,
            EnrollmentState.LocalPersistenceUnavailable,
            EnrollmentState.PreparingKeys,
            EnrollmentState.Bootstrapping,
            EnrollmentState.PairingPending("device-1"),
            EnrollmentState.FailedInvitationInvalid,
            EnrollmentState.CryptoReviewRequired,
            EnrollmentState.SecureKeyUnavailable,
            EnrollmentState.Revoked,
        )

        blockedStates.forEach { state -> assertFalse(state.toString(), shouldShowEnrollmentEntry(state)) }
    }
}
