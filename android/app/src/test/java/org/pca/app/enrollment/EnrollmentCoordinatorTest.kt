package org.pca.app.enrollment

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.pca.app.foundation.InMemoryPersistentStateStore
import org.pca.app.security.CryptoSuiteNotApprovedException
import org.pca.app.security.DeviceKeyPairGenerator
import org.pca.app.security.NotApprovedDeviceKeyPairGenerator
import org.pca.app.security.TestConformanceDeviceKeyPairGenerator
import org.pca.app.storage.FamilyStateStore
import org.pca.app.storage.PersistentFamilyStateStore

private const val LINK = "pca://enroll?token=raw-token-xyz"

/** Fake [DeviceBootstrapApiClient] -- lets each test dictate the exact outcome without a real socket, and records whether/what it was called with (to prove the coordinator never sends familyId/role/authority claims and never calls it at all past the crypto gate). */
private class FakeBootstrapApiClient(private val outcome: () -> DeviceBootstrapResult) : DeviceBootstrapApiClient {
    var callCount = 0
        private set
    var lastRawToken: String? = null
        private set

    override suspend fun bootstrap(
        rawInvitationToken: String,
        platform: String,
        signingPublicKeyBase64: String,
        encryptionPublicKeyBase64: String,
    ): DeviceBootstrapResult {
        callCount++
        lastRawToken = rawInvitationToken
        return outcome()
    }
}

private class ThrowingBootstrapApiClient(private val error: BootstrapError) : DeviceBootstrapApiClient {
    var callCount = 0
        private set

    override suspend fun bootstrap(rawInvitationToken: String, platform: String, signingPublicKeyBase64: String, encryptionPublicKeyBase64: String): DeviceBootstrapResult {
        callCount++
        throw error
    }
}

private class NeverCalledBootstrapApiClient : DeviceBootstrapApiClient {
    override suspend fun bootstrap(rawInvitationToken: String, platform: String, signingPublicKeyBase64: String, encryptionPublicKeyBase64: String): DeviceBootstrapResult {
        throw AssertionError("must never be called past the crypto gate")
    }
}

class EnrollmentCoordinatorTest {
    private fun parser() = UriEnrollmentLinkParser(EnrollmentDeepLinkConfig.EXPECTED_SCHEME, EnrollmentDeepLinkConfig.EXPECTED_HOST)

    @Test
    fun `starts NotEnrolled when no local family state exists`() {
        val coordinator = EnrollmentCoordinator(
            linkParser = parser(),
            apiClient = NeverCalledBootstrapApiClient(),
            keyPairGenerator = NotApprovedDeviceKeyPairGenerator(),
            familyStateStore = PersistentFamilyStateStore(InMemoryPersistentStateStore()),
        )
        assertEquals(EnrollmentState.NotEnrolled, coordinator.state.value)
    }

    @Test
    fun `submitting a valid link moves to InvitationReady and never calls the network`() {
        val apiClient = NeverCalledBootstrapApiClient()
        val coordinator = EnrollmentCoordinator(parser(), apiClient, NotApprovedDeviceKeyPairGenerator(), PersistentFamilyStateStore(InMemoryPersistentStateStore()))

        coordinator.submitInvitationLink(LINK)

        assertTrue(coordinator.state.value is EnrollmentState.InvitationReady)
    }

    @Test
    fun `an invalid link never reaches key preparation and reports the generic invalid state`() {
        val coordinator = EnrollmentCoordinator(parser(), NeverCalledBootstrapApiClient(), NotApprovedDeviceKeyPairGenerator(), PersistentFamilyStateStore(InMemoryPersistentStateStore()))

        coordinator.submitInvitationLink("https://not-a-valid-link.example/")

        assertEquals(EnrollmentState.FailedInvitationInvalid, coordinator.state.value)
    }

    @Test
    fun `production crypto gate blocks bootstrap before any network call is reached`() = runTest {
        val familyStateStore = PersistentFamilyStateStore(InMemoryPersistentStateStore())
        val apiClient = NeverCalledBootstrapApiClient()
        val coordinator = EnrollmentCoordinator(parser(), apiClient, NotApprovedDeviceKeyPairGenerator(), familyStateStore)
        coordinator.submitInvitationLink(LINK)

        coordinator.beginBootstrap()

        assertEquals(EnrollmentState.CryptoReviewRequired, coordinator.state.value)
        // No local family state was written either -- a blocked attempt leaves no partial trace.
        assertNull(familyStateStore.currentState())
    }

    @Test
    fun `the crypto gate throws CryptoSuiteNotApprovedException directly -- proving there is no bypass path`() {
        val generator: DeviceKeyPairGenerator = NotApprovedDeviceKeyPairGenerator()
        try {
            generator.generateSigningKeyPair()
            org.junit.Assert.fail("expected CryptoSuiteNotApprovedException")
        } catch (e: CryptoSuiteNotApprovedException) {
            // expected
        }
        try {
            generator.generateEncryptionKeyPair()
            org.junit.Assert.fail("expected CryptoSuiteNotApprovedException")
        } catch (e: CryptoSuiteNotApprovedException) {
            // expected
        }
    }

    @Test
    fun `a full successful bootstrap persists exactly the server-issued deviceId and lands in PairingPending`() = runTest {
        val familyStateStore = PersistentFamilyStateStore(InMemoryPersistentStateStore())
        val apiClient = FakeBootstrapApiClient { DeviceBootstrapResult(deviceId = "server-issued-device-id", status = "PAIRING_PENDING") }
        val coordinator = EnrollmentCoordinator(parser(), apiClient, TestConformanceDeviceKeyPairGenerator(), familyStateStore)
        coordinator.submitInvitationLink(LINK)

        coordinator.beginBootstrap()

        assertEquals(EnrollmentState.PairingPending("server-issued-device-id"), coordinator.state.value)
        assertEquals("server-issued-device-id", familyStateStore.currentState()?.deviceId)
        assertEquals(1, apiClient.callCount)
        assertEquals("raw-token-xyz", apiClient.lastRawToken)
    }

    @Test
    fun `process restart retains the enrolled deviceId with zero network calls`() = runTest {
        val backing = InMemoryPersistentStateStore()
        val firstProcess = EnrollmentCoordinator(
            parser(),
            FakeBootstrapApiClient { DeviceBootstrapResult("device-abc", "PAIRING_PENDING") },
            TestConformanceDeviceKeyPairGenerator(),
            PersistentFamilyStateStore(backing),
        )
        firstProcess.submitInvitationLink(LINK)
        firstProcess.beginBootstrap()
        assertEquals(EnrollmentState.PairingPending("device-abc"), firstProcess.state.value)

        // Simulate a process restart: a fresh coordinator instance over the SAME backing store,
        // with a network client that must never be called.
        val afterRestart = EnrollmentCoordinator(
            parser(),
            NeverCalledBootstrapApiClient(),
            NotApprovedDeviceKeyPairGenerator(),
            PersistentFamilyStateStore(backing),
        )

        assertEquals(EnrollmentState.PairingPending("device-abc"), afterRestart.state.value)
    }

    @Test
    fun `offline restart -- reboot or otherwise -- retains identity purely from local storage`() {
        // Same backing store as would survive a reboot (PersistentFamilyStateStore's own
        // durability is independently proven in PersistentFamilyStateStoreTest); this test proves
        // the COORDINATOR layer built on top of it reads that state without any network
        // dependency, boot-instance id, or ANDROID_ID input of any kind -- its constructor takes
        // no such parameter at all.
        val backing = InMemoryPersistentStateStore()
        PersistentFamilyStateStore(backing).save(
            org.pca.app.storage.LocalFamilyState(
                familyId = "",
                deviceId = "device-after-reboot",
                pairingState = PairingState.PAIRING_PENDING,
                trustSetEpoch = 0,
                keyEpoch = 0,
            ),
        )

        val coordinator = EnrollmentCoordinator(parser(), NeverCalledBootstrapApiClient(), NotApprovedDeviceKeyPairGenerator(), PersistentFamilyStateStore(backing))

        assertEquals(EnrollmentState.PairingPending("device-after-reboot"), coordinator.state.value)
    }

    @Test
    fun `revoked local state is honestly surfaced, never as PairingPending`() {
        val backing = InMemoryPersistentStateStore()
        PersistentFamilyStateStore(backing).save(
            org.pca.app.storage.LocalFamilyState(familyId = "", deviceId = "device-x", pairingState = PairingState.REVOKED, trustSetEpoch = 0, keyEpoch = 0),
        )

        val coordinator = EnrollmentCoordinator(parser(), NeverCalledBootstrapApiClient(), NotApprovedDeviceKeyPairGenerator(), PersistentFamilyStateStore(backing))

        assertEquals(EnrollmentState.Revoked, coordinator.state.value)
    }

    @Test
    fun `server 404 invitation_unavailable clears the token and never claims retry-ability`() = runTest {
        val apiClient = ThrowingBootstrapApiClient(BootstrapError.InvitationUnavailable)
        val coordinator = EnrollmentCoordinator(parser(), apiClient, TestConformanceDeviceKeyPairGenerator(), PersistentFamilyStateStore(InMemoryPersistentStateStore()))
        coordinator.submitInvitationLink(LINK)

        coordinator.beginBootstrap()

        assertEquals(EnrollmentState.FailedInvitationInvalid, coordinator.state.value)
        // Submitting the exact same link again must go through link parsing again -- beginBootstrap
        // alone (with no fresh submitInvitationLink) must be a no-op, proving the token was cleared.
        coordinator.beginBootstrap()
        assertEquals(1, apiClient.callCount)
    }

    @Test
    fun `an ambiguous network outcome lands in BootstrapResultUnknown -- not success, not failure, and is never auto-retried`() = runTest {
        val apiClient = ThrowingBootstrapApiClient(BootstrapError.AmbiguousOutcome)
        val familyStateStore = PersistentFamilyStateStore(InMemoryPersistentStateStore())
        val coordinator = EnrollmentCoordinator(parser(), apiClient, TestConformanceDeviceKeyPairGenerator(), familyStateStore)
        coordinator.submitInvitationLink(LINK)

        coordinator.beginBootstrap()

        assertEquals(EnrollmentState.BootstrapResultUnknown, coordinator.state.value)
        assertNull(familyStateStore.currentState())
        assertEquals(1, apiClient.callCount)
        // The coordinator itself performs no automatic second attempt -- callCount stays 1 forever
        // unless a caller explicitly re-invokes beginBootstrap (a human-directed action, never
        // internal to this class).
    }

    @Test
    fun `a malformed request outcome (400) is retryable, distinct from the invitation-invalid outcome`() = runTest {
        val apiClient = ThrowingBootstrapApiClient(BootstrapError.InvalidRequest)
        val coordinator = EnrollmentCoordinator(parser(), apiClient, TestConformanceDeviceKeyPairGenerator(), PersistentFamilyStateStore(InMemoryPersistentStateStore()))
        coordinator.submitInvitationLink(LINK)

        coordinator.beginBootstrap()

        assertEquals(EnrollmentState.FailedRetryable, coordinator.state.value)
    }

    @Test
    fun `never sends familyId, role, or any authority claim -- the fake client's method signature has no such parameter`() = runTest {
        // Structural proof: DeviceBootstrapApiClient.bootstrap's signature (rawInvitationToken,
        // platform, signingPublicKeyBase64, encryptionPublicKeyBase64) has no familyId/role
        // parameter at all -- there is no argument this coordinator COULD populate with one, by
        // construction of the interface itself.
        val apiClient = FakeBootstrapApiClient { DeviceBootstrapResult("d1", "PAIRING_PENDING") }
        val coordinator = EnrollmentCoordinator(parser(), apiClient, TestConformanceDeviceKeyPairGenerator(), PersistentFamilyStateStore(InMemoryPersistentStateStore()))
        coordinator.submitInvitationLink(LINK)

        coordinator.beginBootstrap()

        assertEquals("raw-token-xyz", apiClient.lastRawToken)
    }
}
