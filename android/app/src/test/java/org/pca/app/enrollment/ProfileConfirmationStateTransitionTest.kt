package org.pca.app.enrollment

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test
import org.pca.app.security.TestConformanceDeviceKeyPairGenerator
import org.pca.app.storage.InMemoryPendingEnrollmentAttemptStore
import org.pca.app.storage.PersistentFamilyStateStore
import org.pca.app.foundation.InMemoryPersistentStateStore

class ProfileConfirmationStateTransitionTest {
    @Test
    fun `a second beginBootstrap preserves confirmation and recovery credentials without another network call`() = runTest {
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
        val familyStateStore = PersistentFamilyStateStore(InMemoryPersistentStateStore())
        val pendingAttemptStore = InMemoryPendingEnrollmentAttemptStore()
        val coordinator = EnrollmentCoordinator(
            UriEnrollmentLinkParser(EnrollmentDeepLinkConfig.EXPECTED_SCHEME, EnrollmentDeepLinkConfig.EXPECTED_HOST),
            apiClient,
            TestConformanceDeviceKeyPairGenerator(),
            familyStateStore,
            pendingAttemptStore,
        )

        coordinator.submitInvitationLink("pca://enroll?token=raw-token-profile-confirmation")
        coordinator.beginBootstrap()
        val profile = coordinator.state.value
        val pending = pendingAttemptStore.current()
        assertTrue(profile is EnrollmentState.ProfileConfirmation)
        assertNotNull(pending)
        assertNull(familyStateStore.currentState())

        coordinator.beginBootstrap()

        assertEquals(profile, coordinator.state.value)
        assertEquals(pending, pendingAttemptStore.current())
        assertNull(familyStateStore.currentState())
        assertEquals(1, bootstrapCallCount)

        coordinator.confirmProfile()
        assertEquals(EnrollmentState.PairingPending("device-profile-confirmation"), coordinator.state.value)
        assertEquals("device-profile-confirmation", familyStateStore.currentState()?.deviceId)
        assertNull(pendingAttemptStore.current())
        assertEquals(1, bootstrapCallCount)
    }
}
