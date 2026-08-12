package org.pca.app.enrollment

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.pca.app.foundation.InMemoryPersistentStateStore
import org.pca.app.security.CryptoSuiteNotApprovedException
import org.pca.app.security.DeviceKeyPairGenerator
import org.pca.app.security.GeneratedKeyPair
import org.pca.app.security.NotApprovedDeviceKeyPairGenerator
import org.pca.app.security.TestConformanceDeviceKeyPairGenerator
import org.pca.app.storage.FamilyStateStore
import org.pca.app.storage.InMemoryPendingEnrollmentAttemptStore
import org.pca.app.storage.PendingEnrollmentAttemptStore
import org.pca.app.storage.PersistentFamilyStateStore
import org.pca.app.storage.PersistentPendingEnrollmentAttemptStore

private const val LINK = "pca://enroll?token=raw-token-xyz"

/** Fake [DeviceBootstrapApiClient] -- lets each test dictate the exact outcome without a real socket, and records every bootstrap()/recoverAttempt() call so tests can prove the coordinator never sends familyId/role/authority claims, reuses the same attemptId on retry, and never calls the network at all past the crypto gate. */
private class FakeBootstrapApiClient(private val outcome: () -> DeviceBootstrapResult) : DeviceBootstrapApiClient {
    var callCount = 0
        private set
    var lastRawToken: String? = null
        private set
    val attemptIdsSeen = mutableListOf<String>()
    val recoveryTokensSeen = mutableListOf<String>()

    override suspend fun bootstrap(
        rawInvitationToken: String,
        platform: String,
        signingPublicKeyBase64: String,
        encryptionPublicKeyBase64: String,
        bootstrapAttemptId: String,
        attemptRecoveryToken: String,
    ): DeviceBootstrapResult {
        callCount++
        lastRawToken = rawInvitationToken
        attemptIdsSeen += bootstrapAttemptId
        recoveryTokensSeen += attemptRecoveryToken
        return outcome()
    }

    override suspend fun recoverAttempt(bootstrapAttemptId: String, attemptRecoveryToken: String): DeviceBootstrapResult {
        throw AssertionError("recoverAttempt must not be called by this fake")
    }
}

private class ThrowingBootstrapApiClient(private val error: BootstrapError) : DeviceBootstrapApiClient {
    var callCount = 0
        private set
    val attemptIdsSeen = mutableListOf<String>()

    override suspend fun bootstrap(
        rawInvitationToken: String,
        platform: String,
        signingPublicKeyBase64: String,
        encryptionPublicKeyBase64: String,
        bootstrapAttemptId: String,
        attemptRecoveryToken: String,
    ): DeviceBootstrapResult {
        callCount++
        attemptIdsSeen += bootstrapAttemptId
        throw error
    }

    override suspend fun recoverAttempt(bootstrapAttemptId: String, attemptRecoveryToken: String): DeviceBootstrapResult {
        throw AssertionError("recoverAttempt must not be called by this fake")
    }
}

private class NeverCalledBootstrapApiClient : DeviceBootstrapApiClient {
    override suspend fun bootstrap(rawInvitationToken: String, platform: String, signingPublicKeyBase64: String, encryptionPublicKeyBase64: String, bootstrapAttemptId: String, attemptRecoveryToken: String): DeviceBootstrapResult {
        throw AssertionError("must never be called past the crypto gate")
    }

    override suspend fun recoverAttempt(bootstrapAttemptId: String, attemptRecoveryToken: String): DeviceBootstrapResult {
        throw AssertionError("must never be called")
    }
}

/** Dictates the recoverAttempt() outcome only; bootstrap() must never be called from these tests. */
private class FakeRecoveryApiClient(private val outcome: () -> DeviceBootstrapResult) : DeviceBootstrapApiClient {
    var recoverCallCount = 0
        private set
    var lastAttemptId: String? = null
        private set
    var lastRecoveryToken: String? = null
        private set

    override suspend fun bootstrap(rawInvitationToken: String, platform: String, signingPublicKeyBase64: String, encryptionPublicKeyBase64: String, bootstrapAttemptId: String, attemptRecoveryToken: String): DeviceBootstrapResult {
        throw AssertionError("bootstrap() must not be called from a recovery-only test")
    }

    override suspend fun recoverAttempt(bootstrapAttemptId: String, attemptRecoveryToken: String): DeviceBootstrapResult {
        recoverCallCount++
        lastAttemptId = bootstrapAttemptId
        lastRecoveryToken = attemptRecoveryToken
        return outcome()
    }
}

private class ThrowingRecoveryApiClient(private val error: RecoveryError) : DeviceBootstrapApiClient {
    var recoverCallCount = 0
        private set

    override suspend fun bootstrap(rawInvitationToken: String, platform: String, signingPublicKeyBase64: String, encryptionPublicKeyBase64: String, bootstrapAttemptId: String, attemptRecoveryToken: String): DeviceBootstrapResult {
        throw AssertionError("bootstrap() must not be called from a recovery-only test")
    }

    override suspend fun recoverAttempt(bootstrapAttemptId: String, attemptRecoveryToken: String): DeviceBootstrapResult {
        recoverCallCount++
        throw error
    }
}

/** Counts calls without changing behavior -- proves a retry never mints a new key pair. */
private class CountingKeyPairGenerator(private val delegate: DeviceKeyPairGenerator) : DeviceKeyPairGenerator {
    var signingCallCount = 0
        private set
    var encryptionCallCount = 0
        private set

    override fun generateSigningKeyPair(): GeneratedKeyPair {
        signingCallCount++
        return delegate.generateSigningKeyPair()
    }

    override fun generateEncryptionKeyPair(): GeneratedKeyPair {
        encryptionCallCount++
        return delegate.generateEncryptionKeyPair()
    }
}

class EnrollmentCoordinatorTest {
    private fun parser() = UriEnrollmentLinkParser(EnrollmentDeepLinkConfig.EXPECTED_SCHEME, EnrollmentDeepLinkConfig.EXPECTED_HOST)

    private fun coordinator(
        apiClient: DeviceBootstrapApiClient,
        keyPairGenerator: DeviceKeyPairGenerator = NotApprovedDeviceKeyPairGenerator(),
        familyStateStore: FamilyStateStore = PersistentFamilyStateStore(InMemoryPersistentStateStore()),
        pendingAttemptStore: PendingEnrollmentAttemptStore = InMemoryPendingEnrollmentAttemptStore(),
    ) = EnrollmentCoordinator(parser(), apiClient, keyPairGenerator, familyStateStore, pendingAttemptStore)

    @Test
    fun `starts NotEnrolled when no local family state and no pending attempt exists`() {
        val c = coordinator(NeverCalledBootstrapApiClient())
        assertEquals(EnrollmentState.NotEnrolled, c.state.value)
    }

    @Test
    fun `submitting a valid link moves to InvitationReady and never calls the network`() {
        val c = coordinator(NeverCalledBootstrapApiClient())
        c.submitInvitationLink(LINK)
        assertTrue(c.state.value is EnrollmentState.InvitationReady)
    }

    @Test
    fun `an invalid link never reaches key preparation and reports the generic invalid state`() {
        val c = coordinator(NeverCalledBootstrapApiClient())
        c.submitInvitationLink("https://not-a-valid-link.example/")
        assertEquals(EnrollmentState.FailedInvitationInvalid, c.state.value)
    }

    @Test
    fun `production crypto gate blocks bootstrap before any network call is reached`() = runTest {
        val familyStateStore = PersistentFamilyStateStore(InMemoryPersistentStateStore())
        val pendingAttemptStore = InMemoryPendingEnrollmentAttemptStore()
        val c = coordinator(NeverCalledBootstrapApiClient(), familyStateStore = familyStateStore, pendingAttemptStore = pendingAttemptStore)
        c.submitInvitationLink(LINK)

        c.beginBootstrap()

        assertEquals(EnrollmentState.CryptoReviewRequired, c.state.value)
        // No local family state and no pending-attempt record either -- a blocked attempt leaves no partial trace.
        assertNull(familyStateStore.currentState())
        assertNull(pendingAttemptStore.current())
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
    fun `a full successful bootstrap persists exactly the server-issued deviceId, lands in PairingPending, and clears the pending attempt`() = runTest {
        val familyStateStore = PersistentFamilyStateStore(InMemoryPersistentStateStore())
        val pendingAttemptStore = InMemoryPendingEnrollmentAttemptStore()
        val apiClient = FakeBootstrapApiClient { DeviceBootstrapResult(deviceId = "server-issued-device-id", status = "PAIRING_PENDING") }
        val c = coordinator(apiClient, TestConformanceDeviceKeyPairGenerator(), familyStateStore, pendingAttemptStore)
        c.submitInvitationLink(LINK)

        c.beginBootstrap()

        assertEquals(EnrollmentState.PairingPending("server-issued-device-id"), c.state.value)
        assertEquals("server-issued-device-id", familyStateStore.currentState()?.deviceId)
        assertEquals(1, apiClient.callCount)
        assertEquals("raw-token-xyz", apiClient.lastRawToken)
        assertNull(pendingAttemptStore.current())
    }

    @Test
    fun `pending attempt is durably persisted BEFORE the network call, with attemptId+recoveryToken+key material`() = runTest {
        val pendingAttemptStore = InMemoryPendingEnrollmentAttemptStore()
        // A client that reads the pending-attempt store mid-call to prove it is already written.
        var sawDuringCall: org.pca.app.storage.PendingEnrollmentAttempt? = null
        val apiClient = object : DeviceBootstrapApiClient {
            override suspend fun bootstrap(rawInvitationToken: String, platform: String, signingPublicKeyBase64: String, encryptionPublicKeyBase64: String, bootstrapAttemptId: String, attemptRecoveryToken: String): DeviceBootstrapResult {
                sawDuringCall = pendingAttemptStore.current()
                return DeviceBootstrapResult("d1", "PAIRING_PENDING")
            }
            override suspend fun recoverAttempt(bootstrapAttemptId: String, attemptRecoveryToken: String) = throw AssertionError()
        }
        val c = coordinator(apiClient, TestConformanceDeviceKeyPairGenerator(), pendingAttemptStore = pendingAttemptStore)
        c.submitInvitationLink(LINK)

        c.beginBootstrap()

        val seen = sawDuringCall
        assertTrue(seen != null)
        assertTrue(seen!!.attemptId.isNotBlank())
        assertTrue(seen.attemptRecoveryToken.isNotBlank())
        assertTrue(seen.signingPublicKeyBase64.isNotBlank())
        assertTrue(seen.signingPrivateKeyAlias.isNotBlank())
        assertTrue(seen.encryptionPublicKeyBase64.isNotBlank())
        assertTrue(seen.encryptionPrivateKeyAlias.isNotBlank())
    }

    @Test
    fun `process restart retains the enrolled deviceId with zero network calls`() = runTest {
        val backing = InMemoryPersistentStateStore()
        val firstProcess = EnrollmentCoordinator(
            parser(),
            FakeBootstrapApiClient { DeviceBootstrapResult("device-abc", "PAIRING_PENDING") },
            TestConformanceDeviceKeyPairGenerator(),
            PersistentFamilyStateStore(backing),
            InMemoryPendingEnrollmentAttemptStore(),
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
            InMemoryPendingEnrollmentAttemptStore(),
        )

        assertEquals(EnrollmentState.PairingPending("device-abc"), afterRestart.state.value)
    }

    @Test
    fun `offline restart -- reboot or otherwise -- retains identity purely from local storage`() {
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

        val c = coordinator(NeverCalledBootstrapApiClient(), familyStateStore = PersistentFamilyStateStore(backing))

        assertEquals(EnrollmentState.PairingPending("device-after-reboot"), c.state.value)
    }

    @Test
    fun `revoked local state is honestly surfaced, never as PairingPending`() {
        val backing = InMemoryPersistentStateStore()
        PersistentFamilyStateStore(backing).save(
            org.pca.app.storage.LocalFamilyState(familyId = "", deviceId = "device-x", pairingState = PairingState.REVOKED, trustSetEpoch = 0, keyEpoch = 0),
        )

        val c = coordinator(NeverCalledBootstrapApiClient(), familyStateStore = PersistentFamilyStateStore(backing))

        assertEquals(EnrollmentState.Revoked, c.state.value)
    }

    @Test
    fun `server 404 invitation_unavailable clears the token AND the pending attempt, never claims retry-ability`() = runTest {
        val apiClient = ThrowingBootstrapApiClient(BootstrapError.InvitationUnavailable)
        val pendingAttemptStore = InMemoryPendingEnrollmentAttemptStore()
        val c = coordinator(apiClient, TestConformanceDeviceKeyPairGenerator(), pendingAttemptStore = pendingAttemptStore)
        c.submitInvitationLink(LINK)

        c.beginBootstrap()

        assertEquals(EnrollmentState.FailedInvitationInvalid, c.state.value)
        assertNull(pendingAttemptStore.current())
        // Submitting the exact same link again must go through link parsing again -- beginBootstrap
        // alone (with no fresh submitInvitationLink) must be a no-op, proving the token was cleared.
        c.beginBootstrap()
        assertEquals(1, apiClient.callCount)
    }

    @Test
    fun `an ambiguous network outcome lands in BootstrapResultUnknown -- not success, not failure, and is never auto-retried`() = runTest {
        val apiClient = ThrowingBootstrapApiClient(BootstrapError.AmbiguousOutcome)
        val familyStateStore = PersistentFamilyStateStore(InMemoryPersistentStateStore())
        val pendingAttemptStore = InMemoryPendingEnrollmentAttemptStore()
        val c = coordinator(apiClient, TestConformanceDeviceKeyPairGenerator(), familyStateStore, pendingAttemptStore)
        c.submitInvitationLink(LINK)

        c.beginBootstrap()

        assertEquals(EnrollmentState.BootstrapResultUnknown, c.state.value)
        assertNull(familyStateStore.currentState())
        assertEquals(1, apiClient.callCount)
        // The pending attempt is preserved -- section 12: an ambiguous outcome must not delete keys.
        assertTrue(pendingAttemptStore.current() != null)
        // The coordinator itself performs no automatic second attempt -- callCount stays 1 forever
        // unless a caller explicitly re-invokes retryBootstrap (a human-directed action, never
        // internal to this class).
    }

    @Test
    fun `a malformed request outcome (400) is retryable, distinct from the invitation-invalid outcome, and clears the pending attempt`() = runTest {
        val apiClient = ThrowingBootstrapApiClient(BootstrapError.InvalidRequest)
        val pendingAttemptStore = InMemoryPendingEnrollmentAttemptStore()
        val c = coordinator(apiClient, TestConformanceDeviceKeyPairGenerator(), pendingAttemptStore = pendingAttemptStore)
        c.submitInvitationLink(LINK)

        c.beginBootstrap()

        assertEquals(EnrollmentState.FailedRetryable, c.state.value)
        assertNull(pendingAttemptStore.current())
    }

    @Test
    fun `an ordinary server failure (5xx) preserves the pending attempt for a later retry`() = runTest {
        val apiClient = ThrowingBootstrapApiClient(BootstrapError.UnexpectedServerError)
        val pendingAttemptStore = InMemoryPendingEnrollmentAttemptStore()
        val c = coordinator(apiClient, TestConformanceDeviceKeyPairGenerator(), pendingAttemptStore = pendingAttemptStore)
        c.submitInvitationLink(LINK)

        c.beginBootstrap()

        assertEquals(EnrollmentState.FailedRetryable, c.state.value)
        assertTrue(pendingAttemptStore.current() != null)
    }

    @Test
    fun `never sends familyId, role, or any authority claim -- the fake client's method signature has no such parameter`() = runTest {
        // Structural proof: DeviceBootstrapApiClient.bootstrap's signature (rawInvitationToken,
        // platform, signingPublicKeyBase64, encryptionPublicKeyBase64, bootstrapAttemptId,
        // attemptRecoveryToken) has no familyId/role parameter at all -- there is no argument this
        // coordinator COULD populate with one, by construction of the interface itself.
        val apiClient = FakeBootstrapApiClient { DeviceBootstrapResult("d1", "PAIRING_PENDING") }
        val c = coordinator(apiClient, TestConformanceDeviceKeyPairGenerator())
        c.submitInvitationLink(LINK)

        c.beginBootstrap()

        assertEquals("raw-token-xyz", apiClient.lastRawToken)
    }

    // --- PCA-ENROLLMENT-RUNTIME-2: retry / keypair-reuse / recovery tests ---

    @Test
    fun `retryBootstrap after an ambiguous outcome reuses the SAME attemptId and SAME key pair -- never mints new keys`() = runTest {
        var callNumber = 0
        val apiClient = object : DeviceBootstrapApiClient {
            val attemptIds = mutableListOf<String>()
            override suspend fun bootstrap(rawInvitationToken: String, platform: String, signingPublicKeyBase64: String, encryptionPublicKeyBase64: String, bootstrapAttemptId: String, attemptRecoveryToken: String): DeviceBootstrapResult {
                callNumber++
                attemptIds += bootstrapAttemptId
                if (callNumber == 1) throw BootstrapError.AmbiguousOutcome
                return DeviceBootstrapResult("device-retry", "PAIRING_PENDING")
            }
            override suspend fun recoverAttempt(bootstrapAttemptId: String, attemptRecoveryToken: String) = throw AssertionError()
        }
        val keyGen = CountingKeyPairGenerator(TestConformanceDeviceKeyPairGenerator())
        val c = coordinator(apiClient, keyGen)
        c.submitInvitationLink(LINK)

        c.beginBootstrap()
        assertEquals(EnrollmentState.BootstrapResultUnknown, c.state.value)
        assertEquals(1, keyGen.signingCallCount)
        assertEquals(1, keyGen.encryptionCallCount)

        c.retryBootstrap()
        assertEquals(EnrollmentState.PairingPending("device-retry"), c.state.value)
        // No new key pair was generated for the retry.
        assertEquals(1, keyGen.signingCallCount)
        assertEquals(1, keyGen.encryptionCallCount)
        // Same attemptId on both calls.
        assertEquals(2, apiClient.attemptIds.size)
        assertEquals(apiClient.attemptIds[0], apiClient.attemptIds[1])
    }

    @Test
    fun `retryBootstrap with no in-memory token and no pending attempt is a safe no-op reporting FailedInvitationInvalid`() = runTest {
        val c = coordinator(NeverCalledBootstrapApiClient())
        c.retryBootstrap()
        assertEquals(EnrollmentState.FailedInvitationInvalid, c.state.value)
    }

    @Test
    fun `after a process restart with an ambiguous prior attempt, the coordinator starts in RecoveryPending`() {
        val backing = InMemoryPersistentStateStore()
        val pendingAttemptStore = PersistentPendingEnrollmentAttemptStore(backing)
        pendingAttemptStore.save(
            org.pca.app.storage.PendingEnrollmentAttempt(
                attemptId = "attempt-restore-1",
                attemptRecoveryToken = "recovery-secret-restore-1",
                serverBaseUrl = "https://api.pca.app",
                platform = "ANDROID",
                signingPublicKeyBase64 = "dsk",
                signingPrivateKeyAlias = "dsk-alias",
                encryptionPublicKeyBase64 = "dek",
                encryptionPrivateKeyAlias = "dek-alias",
                status = org.pca.app.storage.PendingEnrollmentAttemptStatus.RESULT_UNKNOWN,
            ),
        )

        val c = EnrollmentCoordinator(
            parser(),
            NeverCalledBootstrapApiClient(),
            NotApprovedDeviceKeyPairGenerator(),
            PersistentFamilyStateStore(InMemoryPersistentStateStore()),
            pendingAttemptStore,
        )

        assertEquals(EnrollmentState.RecoveryPending("https://api.pca.app"), c.state.value)
    }

    @Test
    fun `recoverAttempt after restart resolves to PairingPending using only attemptId+recoveryToken, no raw token needed`() = runTest {
        val backing = InMemoryPersistentStateStore()
        val pendingAttemptStore = PersistentPendingEnrollmentAttemptStore(backing)
        pendingAttemptStore.save(
            org.pca.app.storage.PendingEnrollmentAttempt(
                attemptId = "attempt-recover-1",
                attemptRecoveryToken = "recovery-secret-1",
                serverBaseUrl = "https://api.pca.app",
                platform = "ANDROID",
                signingPublicKeyBase64 = "dsk",
                signingPrivateKeyAlias = "dsk-alias",
                encryptionPublicKeyBase64 = "dek",
                encryptionPrivateKeyAlias = "dek-alias",
                status = org.pca.app.storage.PendingEnrollmentAttemptStatus.RESULT_UNKNOWN,
            ),
        )
        val familyStateStore = PersistentFamilyStateStore(InMemoryPersistentStateStore())
        val apiClient = FakeRecoveryApiClient { DeviceBootstrapResult("recovered-device-id", "PAIRING_PENDING") }
        val c = EnrollmentCoordinator(parser(), apiClient, NotApprovedDeviceKeyPairGenerator(), familyStateStore, pendingAttemptStore)
        assertEquals(EnrollmentState.RecoveryPending("https://api.pca.app"), c.state.value)

        c.recoverAttempt()

        assertEquals(EnrollmentState.PairingPending("recovered-device-id"), c.state.value)
        assertEquals("recovered-device-id", familyStateStore.currentState()?.deviceId)
        assertEquals(1, apiClient.recoverCallCount)
        assertEquals("attempt-recover-1", apiClient.lastAttemptId)
        assertEquals("recovery-secret-1", apiClient.lastRecoveryToken)
        assertNull(pendingAttemptStore.current())
    }

    @Test
    fun `recoverAttempt with a definitive NotFound abandons the attempt -- FailedInvitationInvalid, pending state cleared`() = runTest {
        val pendingAttemptStore = InMemoryPendingEnrollmentAttemptStore()
        pendingAttemptStore.save(
            org.pca.app.storage.PendingEnrollmentAttempt(
                "attempt-x", "secret-x", "https://api.pca.app", "ANDROID", "dsk", "dsk-alias", "dek", "dek-alias",
                org.pca.app.storage.PendingEnrollmentAttemptStatus.RESULT_UNKNOWN,
            ),
        )
        val apiClient = ThrowingRecoveryApiClient(RecoveryError.NotFound)
        val c = EnrollmentCoordinator(parser(), apiClient, NotApprovedDeviceKeyPairGenerator(), PersistentFamilyStateStore(InMemoryPersistentStateStore()), pendingAttemptStore)
        assertTrue(c.state.value is EnrollmentState.RecoveryPending)

        c.recoverAttempt()

        assertEquals(EnrollmentState.FailedInvitationInvalid, c.state.value)
        assertNull(pendingAttemptStore.current())
    }

    @Test
    fun `recoverAttempt with a transient network failure preserves pending state -- no data loss, no auto-retry-storm`() = runTest {
        val pendingAttemptStore = InMemoryPendingEnrollmentAttemptStore()
        pendingAttemptStore.save(
            org.pca.app.storage.PendingEnrollmentAttempt(
                "attempt-y", "secret-y", "https://api.pca.app", "ANDROID", "dsk", "dsk-alias", "dek", "dek-alias",
                org.pca.app.storage.PendingEnrollmentAttemptStatus.RESULT_UNKNOWN,
            ),
        )
        val apiClient = ThrowingRecoveryApiClient(RecoveryError.AmbiguousOutcome)
        val c = EnrollmentCoordinator(parser(), apiClient, NotApprovedDeviceKeyPairGenerator(), PersistentFamilyStateStore(InMemoryPersistentStateStore()), pendingAttemptStore)

        c.recoverAttempt()

        assertEquals(EnrollmentState.RecoveryPending("https://api.pca.app"), c.state.value)
        // The attempt is still there for a later, explicit retry -- not deleted on a transient failure.
        assertTrue(pendingAttemptStore.current() != null)
        assertEquals(1, apiClient.recoverCallCount)

        // A caller (e.g. on reconnect) may explicitly call this again -- bounded, never a storm the
        // coordinator itself triggers.
        c.recoverAttempt()
        assertEquals(2, apiClient.recoverCallCount)
    }

    @Test
    fun `recoverAttempt with no pending attempt on record is a safe no-op`() = runTest {
        val c = coordinator(NeverCalledBootstrapApiClient())
        c.recoverAttempt()
        assertEquals(EnrollmentState.FailedInvitationInvalid, c.state.value)
    }

    @Test
    fun `two independent beginBootstrap calls (two genuinely different attempts) generate DIFFERENT attemptIds`() = runTest {
        val apiClient = FakeBootstrapApiClient { DeviceBootstrapResult("d", "PAIRING_PENDING") }
        val c = coordinator(apiClient, TestConformanceDeviceKeyPairGenerator())
        c.submitInvitationLink(LINK)
        c.beginBootstrap()
        val firstAttemptId = apiClient.attemptIdsSeen.single()

        // A second, independent enrollment attempt (e.g. after successfully pairing this device
        // and later re-enrolling, or a fresh submitInvitationLink) must never reuse the prior
        // attemptId.
        c.submitInvitationLink(LINK)
        c.beginBootstrap()

        assertEquals(2, apiClient.attemptIdsSeen.size)
        assertNotEquals(firstAttemptId, apiClient.attemptIdsSeen[1])
    }
}
