package org.pca.app.enrollment

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.pca.app.security.TestConformanceDeviceKeyPairGenerator
import org.pca.app.storage.InMemoryPendingEnrollmentAttemptStore
import org.pca.app.storage.PersistentFamilyStateStore
import org.pca.app.foundation.InMemoryPersistentStateStore

class ProfileConfirmationStateTransitionTest {
    @Test
    fun `a second beginBootstrap before profile confirmation is rejected without another network call`() = runTest {
        var bootstrapCallCount = 0
        val apiClient = object : DeviceBootstrapApiClient {
            override suspend fun bootstrap(
                rawInvitationToken: String,
                platform: String,
                signingPublicKeyBase64: String,
                encryptionPublicKeyBase64: String,
                bootstrapAttemptId: String,
                attemptRecoveryToken: String,
            ): DeviceBootstrapResult {
                bootstrapCallCount++
                return DeviceBootstrapResult("device-profile-confirmation", "PAIRING_PENDING")
            }

            override suspend fun recoverAttempt(
                bootstrapAttemptId: String,
                attemptRecoveryToken: String,
            ): DeviceBootstrapResult = error("recoverAttempt must not be called")
        }
        val coordinator = EnrollmentCoordinator(
            UriEnrollmentLinkParser(EnrollmentDeepLinkConfig.EXPECTED_SCHEME, EnrollmentDeepLinkConfig.EXPECTED_HOST),
            apiClient,
            TestConformanceDeviceKeyPairGenerator(),
            PersistentFamilyStateStore(InMemoryPersistentStateStore()),
            InMemoryPendingEnrollmentAttemptStore(),
        )

        coordinator.submitInvitationLink("pca://enroll?token=raw-token-profile-confirmation")
        coordinator.beginBootstrap()
        assertTrue(coordinator.state.value is EnrollmentState.ProfileConfirmation)

        coordinator.beginBootstrap()

        assertEquals(EnrollmentState.FailedInvitationInvalid, coordinator.state.value)
        assertEquals(1, bootstrapCallCount)
    }
}
