package org.pca.app.enrollment

import java.security.MessageDigest
import java.util.concurrent.atomic.AtomicReference
import org.junit.Assert.assertNotNull

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.launch
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.test.runCurrent
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
import org.pca.app.storage.PendingEnrollmentAttempt
import org.pca.app.storage.PendingEnrollmentAttemptStore
import org.pca.app.storage.PendingEnrollmentAttemptStatus
import org.pca.app.storage.PersistentFamilyStateStore
import org.pca.app.storage.PersistentPendingEnrollmentAttemptStore

private val VALID_LINK_TOKEN = "A".repeat(43)
private val OTHER_VALID_LINK_TOKEN = "B".repeat(42) + "E"
private val LINK = "pca://enroll?token=$VALID_LINK_TOKEN"

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
    val rawTokensSeen = mutableListOf<String>()

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
        rawTokensSeen += rawInvitationToken
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
    val attemptIdsSeen = mutableListOf<String>()
    val recoveryTokensSeen = mutableListOf<String>()

    override suspend fun bootstrap(rawInvitationToken: String, platform: String, signingPublicKeyBase64: String, encryptionPublicKeyBase64: String, bootstrapAttemptId: String, attemptRecoveryToken: String): DeviceBootstrapResult {
        throw AssertionError("bootstrap() must not be called from a recovery-only test")
    }

    override suspend fun recoverAttempt(bootstrapAttemptId: String, attemptRecoveryToken: String): DeviceBootstrapResult {
        recoverCallCount++
        attemptIdsSeen += bootstrapAttemptId
        recoveryTokensSeen += attemptRecoveryToken
        throw error
    }
}

/** Counts calls without changing behavior -- proves a retry never mints a new key pair. */
private class CountingKeyPairGenerator(private val delegate: DeviceKeyPairGenerator) : DeviceKeyPairGenerator {
    var signingCallCount = 0
        private set
    var encryptionCallCount = 0
        private set

    override fun generateSigningKeyPair(attemptId: String): GeneratedKeyPair {
        signingCallCount++
        return delegate.generateSigningKeyPair(attemptId)
    }

    override fun generateEncryptionKeyPair(attemptId: String): GeneratedKeyPair {
        encryptionCallCount++
        return delegate.generateEncryptionKeyPair(attemptId)
    }
}

private class FaultingEnrollmentBacking : org.pca.app.foundation.PersistentStateStore by InMemoryPersistentStateStore() {
    var successfulFlushesBeforeFailure: Int? = null
    override fun flush() {
        successfulFlushesBeforeFailure?.let {
            if (it == 0) { successfulFlushesBeforeFailure = null; error("disk unavailable") }
            successfulFlushesBeforeFailure = it - 1
        }
    }
}

private class EnrollmentCustodyCounter(
    private val delegate: DeviceKeyPairGenerator = TestConformanceDeviceKeyPairGenerator(),
) : DeviceKeyPairGenerator by delegate, org.pca.app.security.DeviceKeyPairDeletion {
    val deleted = mutableListOf<String>()
    val generatedAliases = mutableListOf<String>()
    val orphanSweepKeepSets = mutableListOf<Set<String>>()
    var failingAlias: String? = null
    var signingGenerations = 0
        private set
    var encryptionGenerations = 0
        private set
    override fun generateSigningKeyPair(attemptId: String): GeneratedKeyPair {
        signingGenerations++
        return delegate.generateSigningKeyPair(attemptId).also { generatedAliases += it.privateKeyAlias }
    }
    override fun generateEncryptionKeyPair(attemptId: String): GeneratedKeyPair {
        encryptionGenerations++
        return delegate.generateEncryptionKeyPair(attemptId).also { generatedAliases += it.privateKeyAlias }
    }
    override fun deleteKeyPair(alias: String) {
        if (alias == failingAlias) error("key deletion failed")
        deleted += alias
    }
    override fun deleteOrphanedAttemptKeys(keepAttemptIds: Set<String>) { orphanSweepKeepSets += keepAttemptIds.toSet() }
}

private class RejectedPrepareApiClient(private val recoveryError: RecoveryError) : DeviceBootstrapApiClient {
    var prepareCalls = 0
    var bootstrapCalls = 0
    var recoveryCalls = 0
    var attemptId: String? = null
    override suspend fun prepareAttempt(
        rawInvitationToken: String,
        platform: String,
        signingPublicKeyBase64: String,
        encryptionPublicKeyBase64: String,
        bootstrapAttemptId: String,
        attemptRecoveryToken: String,
    ) {
        prepareCalls++
        attemptId = bootstrapAttemptId
        throw BootstrapError.InvitationUnavailable
    }
    override suspend fun bootstrap(rawInvitationToken: String, platform: String, signingPublicKeyBase64: String,
        encryptionPublicKeyBase64: String, bootstrapAttemptId: String, attemptRecoveryToken: String): DeviceBootstrapResult {
        bootstrapCalls++
        throw AssertionError("bootstrap must not follow a rejected reservation")
    }
    override suspend fun recoverAttempt(bootstrapAttemptId: String, attemptRecoveryToken: String): DeviceBootstrapResult {
        recoveryCalls++
        throw recoveryError
    }
}

/** Separates staged writes from the process-restart snapshot for durability-barrier regressions. */
private class DurableFaultingEnrollmentBacking(
    initial: Map<String, String> = emptyMap(),
) : org.pca.app.foundation.PersistentStateStore {
    override val coordinationLock: Any = this
    private var staged = initial.toMutableMap()
    private var durable = initial.toMap()
    var failNextFlush = false

    override fun getString(key: String): String? = staged[key]
    override fun putString(key: String, value: String) { staged[key] = value }
    override fun remove(key: String) { staged.remove(key) }
    override fun contains(key: String): Boolean = staged.containsKey(key)
    override fun clear() { staged.clear() }
    override fun flush() {
        if (failNextFlush) {
            failNextFlush = false
            error("disk unavailable")
        }
        durable = staged.toMap()
    }

    fun simulateProcessRestart() {
        staged = durable.toMutableMap()
    }
}

@OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
class EnrollmentCoordinatorTest {
    @Test
    fun `missing first-device root store disables destructive orphan-key sweep`() = runTest {
        val custody = EnrollmentCustodyCounter()
        val api = FakeBootstrapApiClient { DeviceBootstrapResult("device", "PAIRING_PENDING") }
        val c = coordinator(api, custody)
        c.submitInvitationLink(LINK)

        c.beginBootstrap()

        assertTrue(custody.orphanSweepKeepSets.isEmpty())
        assertEquals(1, api.callCount)
    }

    @Test
    fun `pending durability failure blocks submission and all subsequent actions`() = runTest {
        val backing = object : org.pca.app.foundation.PersistentStateStore by InMemoryPersistentStateStore() {
            override fun flush() { error("disk unavailable") }
        }
        val api = FakeBootstrapApiClient { DeviceBootstrapResult("device", "PAIRING_PENDING") }
        val c = coordinator(api, TestConformanceDeviceKeyPairGenerator(),
            PersistentFamilyStateStore(backing), org.pca.app.storage.PersistentPendingEnrollmentAttemptStore(backing))
        c.submitInvitationLink(LINK)
        c.beginBootstrap()
        assertEquals(EnrollmentState.LocalPersistenceUnavailable, c.state.value)
        assertEquals(0, api.callCount)
        c.retryBootstrap()
        c.recoverAttempt()
        c.submitInvitationLink(LINK)
        c.confirmProfile()
        assertEquals(0, api.callCount)
        assertEquals(EnrollmentState.LocalPersistenceUnavailable, c.state.value)
    }

    @Test
    fun `family write and pending cleanup failure retain recovery after restart`() = runTest {
        for (successfulFlushes in listOf(0, 1)) {
            val backing = FaultingEnrollmentBacking()
            val family = PersistentFamilyStateStore(backing)
            val pending = PersistentPendingEnrollmentAttemptStore(backing)
            val api = FakeBootstrapApiClient { DeviceBootstrapResult("device", "PAIRING_PENDING") }
            val c = coordinator(api, TestConformanceDeviceKeyPairGenerator(), family, pending)
            c.submitInvitationLink(LINK)
            c.beginBootstrap()
            val original = pending.current()
            backing.successfulFlushesBeforeFailure = successfulFlushes
            c.confirmProfile()
            assertEquals(EnrollmentState.LocalPersistenceUnavailable, c.state.value)
            assertEquals(original, pending.current())
            if (successfulFlushes == 0) assertNull(family.currentState())
            else assertEquals("device", family.currentState()?.deviceId)
            val recovery = FakeRecoveryApiClient { DeviceBootstrapResult("device", "PAIRING_PENDING") }
            val restarted = coordinator(recovery, TestConformanceDeviceKeyPairGenerator(), family, pending)
            assertTrue(restarted.state.value is EnrollmentState.RecoveryPending)
            restarted.recoverAttempt()
            restarted.confirmProfile()
            assertEquals(EnrollmentState.PairingPending("device"), restarted.state.value)
            assertNull(pending.current())
        }
    }

    @Test
    fun `bootstrap HTTP 400 preserves pending attempt and keys when storage later fails`() = runTest {
        val backing = FaultingEnrollmentBacking()
        val pending = PersistentPendingEnrollmentAttemptStore(backing)
        val custody = EnrollmentCustodyCounter()
        val api = FakeBootstrapApiClient {
            backing.successfulFlushesBeforeFailure = 0
            throw BootstrapError.InvalidRequest
        }
        val c = coordinator(api, custody, PersistentFamilyStateStore(backing), pending)
        c.submitInvitationLink(LINK)
        c.beginBootstrap()
        assertEquals(EnrollmentState.BootstrapResultUnknown, c.state.value)
        assertNotNull(pending.current())
        assertTrue(custody.deleted.isEmpty())
    }

    @Test
    fun `malformed pending record blocks enrollment on restart`() = runTest {
        val backing = InMemoryPersistentStateStore().apply { putString("pending_enrollment_attempt_v1", "unreadable") }
        val c = coordinator(NeverCalledBootstrapApiClient(), TestConformanceDeviceKeyPairGenerator(),
            PersistentFamilyStateStore(backing), PersistentPendingEnrollmentAttemptStore(backing))
        assertEquals(EnrollmentState.LocalPersistenceUnavailable, c.state.value)
        c.submitInvitationLink(LINK)
        c.beginBootstrap()
        assertEquals(EnrollmentState.LocalPersistenceUnavailable, c.state.value)
        assertEquals("unreadable", backing.getString("pending_enrollment_attempt_v1"))
    }

    @Test
    fun `restart cleanup cannot replace a committed device identity`() = runTest {
        val family = PersistentFamilyStateStore(InMemoryPersistentStateStore())
        val pending = InMemoryPendingEnrollmentAttemptStore()
        val c = coordinator(FakeBootstrapApiClient { DeviceBootstrapResult("original", "PAIRING_PENDING") },
            TestConformanceDeviceKeyPairGenerator(), family, pending)
        c.submitInvitationLink(LINK)
        c.beginBootstrap()
        val attempt = pending.current()!!
        c.confirmProfile()
        pending.save(attempt)
        val restarted = coordinator(FakeRecoveryApiClient { DeviceBootstrapResult("different", "PAIRING_PENDING") },
            TestConformanceDeviceKeyPairGenerator(), family, pending)
        restarted.recoverAttempt()
        restarted.confirmProfile()
        assertEquals(EnrollmentState.LocalPersistenceUnavailable, restarted.state.value)
        assertEquals("original", family.currentState()?.deviceId)
        assertEquals(attempt, pending.current())
    }

    @Test
    fun `recovery errors preserve pending credentials and committed family key custody`() = runTest {
        for (error in listOf(RecoveryError.NotFound, RecoveryError.InvalidRequest)) {
            val family = PersistentFamilyStateStore(InMemoryPersistentStateStore())
            val pending = InMemoryPendingEnrollmentAttemptStore()
            val custody = EnrollmentCustodyCounter()
            val c = coordinator(FakeBootstrapApiClient { DeviceBootstrapResult("device", "PAIRING_PENDING") }, custody, family, pending)
            c.submitInvitationLink(LINK)
            c.beginBootstrap()
            val retained = pending.current()!!
            c.confirmProfile()
            pending.save(retained) // models a prior process whose final cleanup was not durable
            val restarted = coordinator(ThrowingRecoveryApiClient(error), custody, family, pending)
            restarted.recoverAttempt()
            assertTrue(custody.deleted.isEmpty())
            assertEquals(retained, pending.current())
            assertEquals("device", family.currentState()?.deviceId)
        }
    }

    @Test
    fun `recovery errors preserve durable ceremony seed key custody`() = runTest {
        for (error in listOf(RecoveryError.NotFound, RecoveryError.InvalidRequest)) {
            val pending = InMemoryPendingEnrollmentAttemptStore()
            val custody = EnrollmentCustodyCounter()
            val family = PersistentFamilyStateStore(InMemoryPersistentStateStore())
            val c = coordinator(FakeBootstrapApiClient { DeviceBootstrapResult("device", "PAIRING_PENDING") }, custody, family, pending)
            c.submitInvitationLink(LINK)
            c.beginBootstrap()
            val attempt = pending.current()!!
            val root = org.pca.app.firstdevice.InMemoryFirstDeviceRootStore()
            root.captureSeed(org.pca.app.firstdevice.FirstDeviceRootRecord(
                seed = org.pca.app.firstdevice.FirstDeviceCeremonySeed(
                    attempt.attemptId, attempt.attemptRecoveryToken, attempt.serverBaseUrl,
                    "device", "signing-id", "encryption-id", attempt.signingPublicKeyBase64,
                    attempt.encryptionPublicKeyBase64, attempt.signingPrivateKeyAlias, attempt.encryptionPrivateKeyAlias,
                )), emptySet())
            val restarted = EnrollmentCoordinator(parser(), ThrowingRecoveryApiClient(error), custody, family, pending,
                firstDeviceRootStore = root)
            restarted.recoverAttempt()
            assertTrue(custody.deleted.isEmpty())
            assertEquals(attempt, pending.current())
            assertNotNull(root.current())
        }
    }

    @Test
    fun `recovery HTTP 400 without family or root preserves attempt and both key aliases`() = runTest {
        val backing = InMemoryPersistentStateStore()
        val family = PersistentFamilyStateStore(backing)
        val pending = PersistentPendingEnrollmentAttemptStore(backing)
        val custody = EnrollmentCustodyCounter()
        val initial = coordinator(
            FakeBootstrapApiClient { DeviceBootstrapResult("device", "PAIRING_PENDING") },
            custody,
            family,
            pending,
        )
        initial.submitInvitationLink(LINK)
        initial.beginBootstrap()
        val retained = pending.current()!!
        assertNull(family.currentState())

        val restarted = coordinator(ThrowingRecoveryApiClient(RecoveryError.InvalidRequest), custody, family, pending)
        assertEquals(EnrollmentState.RecoveryPending(retained.serverBaseUrl), restarted.state.value)
        restarted.recoverAttempt()

        assertEquals(EnrollmentState.RecoveryPending(retained.serverBaseUrl), restarted.state.value)
        assertEquals(retained, pending.current())
        assertTrue(custody.deleted.isEmpty())
    }

    private fun parser() = UriEnrollmentLinkParser(
        expectedScheme = EnrollmentDeepLinkConfig.EXPECTED_SCHEME,
        expectedHost = EnrollmentDeepLinkConfig.EXPECTED_HOST,
        appLinkScheme = EnrollmentDeepLinkConfig.APP_LINK_SCHEME,
        appLinkHost = EnrollmentDeepLinkConfig.APP_LINK_HOST,
        appLinkPathPrefix = EnrollmentDeepLinkConfig.APP_LINK_PATH_PREFIX,
    )

    private fun coordinator(
        apiClient: DeviceBootstrapApiClient,
        keyPairGenerator: DeviceKeyPairGenerator = NotApprovedDeviceKeyPairGenerator(),
        familyStateStore: FamilyStateStore = PersistentFamilyStateStore(InMemoryPersistentStateStore()),
        pendingAttemptStore: PendingEnrollmentAttemptStore = InMemoryPendingEnrollmentAttemptStore(),
        firstDeviceRootStore: org.pca.app.firstdevice.FirstDeviceRootStore? = null,
    ) = EnrollmentCoordinator(
        parser(), apiClient, keyPairGenerator, familyStateStore, pendingAttemptStore,
        firstDeviceRootStore = firstDeviceRootStore,
    )

    @Test
    fun `starts NotEnrolled when no local family state and no pending attempt exists`() {
        val c = coordinator(NeverCalledBootstrapApiClient())
        assertEquals(EnrollmentState.NotEnrolled, c.state.value)
    }

    @Test
    fun `corrupt persisted family state blocks invitation enrollment`() = runTest {
        val backing = InMemoryPersistentStateStore().apply {
            putString("family_state_v1", "family|device|NOT_A_PAIRING_STATE|1|1")
        }
        val familyStateStore = PersistentFamilyStateStore(backing)
        val c = coordinator(NeverCalledBootstrapApiClient(), familyStateStore = familyStateStore)

        assertEquals(EnrollmentState.LocalStateCorrupt, c.state.value)
        c.submitInvitationLink(LINK)
        c.beginBootstrap()

        assertEquals(EnrollmentState.LocalStateCorrupt, c.state.value)
        assertEquals("family|device|NOT_A_PAIRING_STATE|1|1", backing.getString("family_state_v1"))
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
            generator.generateSigningKeyPair("test-attempt-id")
            org.junit.Assert.fail("expected CryptoSuiteNotApprovedException")
        } catch (e: CryptoSuiteNotApprovedException) {
            // expected
        }
        try {
            generator.generateEncryptionKeyPair("test-attempt-id")
            org.junit.Assert.fail("expected CryptoSuiteNotApprovedException")
        } catch (e: CryptoSuiteNotApprovedException) {
            // expected
        }
    }

    @Test
    fun `a full successful bootstrap requires child profile confirmation before local persistence`() = runTest {
        val familyStateStore = PersistentFamilyStateStore(InMemoryPersistentStateStore())
        val pendingAttemptStore = InMemoryPendingEnrollmentAttemptStore()
        val apiClient = FakeBootstrapApiClient { DeviceBootstrapResult(deviceId = "server-issued-device-id", status = "PAIRING_PENDING") }
        val c = coordinator(apiClient, TestConformanceDeviceKeyPairGenerator(), familyStateStore, pendingAttemptStore)
        c.submitInvitationLink(LINK)

        c.beginBootstrap()

        assertEquals(
            EnrollmentState.ProfileConfirmation("server-issued-device-id", AgeUxTier.YOUNG_CHILD, InitialPolicyProfile.BALANCED),
            c.state.value,
        )
        assertNull(familyStateStore.currentState())
        assertNotNull(pendingAttemptStore.current())
        c.confirmProfile()
        assertEquals(EnrollmentState.PairingPending("server-issued-device-id"), c.state.value)
        assertEquals("server-issued-device-id", familyStateStore.currentState()?.deviceId)
        assertEquals(1, apiClient.callCount)
        assertEquals(VALID_LINK_TOKEN, apiClient.lastRawToken)
        assertNull(pendingAttemptStore.current())
    }

    @Test
    fun `server reservation is durable before the submitted marker and bootstrap request`() = runTest {
        val pending = InMemoryPendingEnrollmentAttemptStore()
        val calls = mutableListOf<String>()
        val api = object : DeviceBootstrapApiClient {
            override suspend fun prepareAttempt(
                rawInvitationToken: String,
                platform: String,
                signingPublicKeyBase64: String,
                encryptionPublicKeyBase64: String,
                bootstrapAttemptId: String,
                attemptRecoveryToken: String,
            ) {
                calls += "prepare"
                assertEquals(PendingEnrollmentAttemptStatus.PREPARED, pending.current()?.status)
                assertEquals(VALID_LINK_TOKEN, rawInvitationToken)
            }

            override suspend fun bootstrap(
                rawInvitationToken: String,
                platform: String,
                signingPublicKeyBase64: String,
                encryptionPublicKeyBase64: String,
                bootstrapAttemptId: String,
                attemptRecoveryToken: String,
            ) = DeviceBootstrapResult("device-prepared", "PAIRING_PENDING").also {
                calls += "bootstrap"
                assertEquals(PendingEnrollmentAttemptStatus.BOOTSTRAPPING, pending.current()?.status)
            }

            override suspend fun recoverAttempt(bootstrapAttemptId: String, attemptRecoveryToken: String): DeviceBootstrapResult {
                throw AssertionError("fresh enrollment cannot recover")
            }
        }
        val c = coordinator(api, TestConformanceDeviceKeyPairGenerator(), pendingAttemptStore = pending)
        c.submitInvitationLink(LINK)
        c.beginBootstrap()

        assertEquals(listOf("prepare", "bootstrap"), calls)
        assertEquals(EnrollmentState.ProfileConfirmation("device-prepared", AgeUxTier.YOUNG_CHILD, InitialPolicyProfile.BALANCED), c.state.value)
    }

    @Test
    fun `failed durable submitted marker after reservation retains prepared attempt and sends no bootstrap`() = runTest {
        val backing = DurableFaultingEnrollmentBacking()
        val pending = PersistentPendingEnrollmentAttemptStore(backing)
        val custody = EnrollmentCustodyCounter()
        var prepareCalls = 0
        var bootstrapCalls = 0
        val api = object : DeviceBootstrapApiClient {
            override suspend fun prepareAttempt(
                rawInvitationToken: String,
                platform: String,
                signingPublicKeyBase64: String,
                encryptionPublicKeyBase64: String,
                bootstrapAttemptId: String,
                attemptRecoveryToken: String,
            ) {
                prepareCalls++
                assertEquals(PendingEnrollmentAttemptStatus.PREPARED, pending.current()?.status)
                // Let reservation succeed, then fail the next durable write: PREPARED -> BOOTSTRAPPING.
                backing.failNextFlush = true
            }

            override suspend fun bootstrap(
                rawInvitationToken: String,
                platform: String,
                signingPublicKeyBase64: String,
                encryptionPublicKeyBase64: String,
                bootstrapAttemptId: String,
                attemptRecoveryToken: String,
            ): DeviceBootstrapResult {
                bootstrapCalls++
                return DeviceBootstrapResult("unexpected", "PAIRING_PENDING")
            }

            override suspend fun recoverAttempt(bootstrapAttemptId: String, attemptRecoveryToken: String): DeviceBootstrapResult =
                throw AssertionError("marker failure must not trigger automatic recovery")
        }
        val c = coordinator(
            api,
            custody,
            PersistentFamilyStateStore(InMemoryPersistentStateStore()),
            pending,
            org.pca.app.firstdevice.InMemoryFirstDeviceRootStore(),
        )

        c.submitInvitationLink(LINK)
        c.beginBootstrap()

        assertEquals(1, prepareCalls)
        assertEquals(0, bootstrapCalls)
        assertEquals(EnrollmentState.LocalPersistenceUnavailable, c.state.value)
        assertEquals(PendingEnrollmentAttemptStatus.PREPARED, pending.current()?.status)
        val expected = pending.current()
        assertNotNull(expected?.attemptRecoveryToken)
        assertTrue(custody.deleted.isEmpty())
        backing.simulateProcessRestart()
        assertEquals(expected, PersistentPendingEnrollmentAttemptStore(backing).current())
    }

    @Test
    fun `replacement while prepare is suspended prevents bootstrap and stale result publication`() = runTest {
        val prepareStarted = CompletableDeferred<Unit>()
        val finishPrepare = CompletableDeferred<Unit>()
        var bootstrapCalls = 0
        val api = object : DeviceBootstrapApiClient {
            override suspend fun prepareAttempt(
                rawInvitationToken: String,
                platform: String,
                signingPublicKeyBase64: String,
                encryptionPublicKeyBase64: String,
                bootstrapAttemptId: String,
                attemptRecoveryToken: String,
            ) {
                prepareStarted.complete(Unit)
                finishPrepare.await()
            }

            override suspend fun bootstrap(
                rawInvitationToken: String,
                platform: String,
                signingPublicKeyBase64: String,
                encryptionPublicKeyBase64: String,
                bootstrapAttemptId: String,
                attemptRecoveryToken: String,
            ): DeviceBootstrapResult {
                bootstrapCalls++
                return DeviceBootstrapResult("stale-device", "PAIRING_PENDING")
            }

            override suspend fun recoverAttempt(bootstrapAttemptId: String, attemptRecoveryToken: String): DeviceBootstrapResult =
                throw AssertionError("prepare replacement test must not recover")
        }
        val pending = InMemoryPendingEnrollmentAttemptStore()
        val custody = EnrollmentCustodyCounter()
        val c = coordinator(api, custody, pendingAttemptStore = pending)
        c.submitInvitationLink(LINK)
        val begin = launch { c.beginBootstrap() }
        runCurrent()
        prepareStarted.await()
        val original = pending.current()!!
        val replacement = retainedAttempt().copy(
            attemptId = "replacement-attempt-identifier",
            attemptRecoveryToken = "replacement-recovery-token",
            status = PendingEnrollmentAttemptStatus.PREPARED,
        )
        pending.save(replacement)

        finishPrepare.complete(Unit)
        begin.join()

        assertEquals(0, bootstrapCalls)
        assertEquals(replacement, pending.current())
        assertTrue(custody.deleted.isEmpty())
        assertNull(c.keyFingerprints.value)
        assertTrue(c.state.value !is EnrollmentState.ProfileConfirmation)
        assertEquals(EnrollmentState.RecoveryPending(replacement.serverBaseUrl), c.state.value)
        assertNotEquals(original.attemptId, replacement.attemptId)
    }

    @Test
    fun `unreadable attempt after prepare prevents bootstrap and retains unavailable state`() = runTest {
        val backing = InMemoryPendingEnrollmentAttemptStore()
        var attemptReadUnavailable = false
        val pending = object : PendingEnrollmentAttemptStore by backing {
            override fun current(): PendingEnrollmentAttempt? {
                if (attemptReadUnavailable) throw org.pca.app.storage.EnrollmentPersistenceException()
                return backing.current()
            }
        }
        val custody = EnrollmentCustodyCounter()
        var bootstrapCalls = 0
        val api = object : DeviceBootstrapApiClient {
            override suspend fun prepareAttempt(
                rawInvitationToken: String,
                platform: String,
                signingPublicKeyBase64: String,
                encryptionPublicKeyBase64: String,
                bootstrapAttemptId: String,
                attemptRecoveryToken: String,
            ) {
                assertEquals(PendingEnrollmentAttemptStatus.PREPARED, backing.current()?.status)
                attemptReadUnavailable = true
            }

            override suspend fun bootstrap(
                rawInvitationToken: String,
                platform: String,
                signingPublicKeyBase64: String,
                encryptionPublicKeyBase64: String,
                bootstrapAttemptId: String,
                attemptRecoveryToken: String,
            ): DeviceBootstrapResult {
                bootstrapCalls++
                return DeviceBootstrapResult("unexpected", "PAIRING_PENDING")
            }

            override suspend fun recoverAttempt(bootstrapAttemptId: String, attemptRecoveryToken: String): DeviceBootstrapResult =
                throw AssertionError("unreadable local custody must not trigger automatic recovery")
        }
        val c = coordinator(api, custody, pendingAttemptStore = pending)
        c.submitInvitationLink(LINK)

        c.beginBootstrap()

        assertEquals(EnrollmentState.LocalPersistenceUnavailable, c.state.value)
        assertEquals(0, bootstrapCalls)
        assertTrue(backing.current() != null)
        assertTrue(custody.deleted.isEmpty())
    }

    @Test
    fun `bootstrap response cannot claim ACTIVE and pending recovery state is preserved`() = runTest {
        val familyStateStore = PersistentFamilyStateStore(InMemoryPersistentStateStore())
        val pendingAttemptStore = InMemoryPendingEnrollmentAttemptStore()
        val apiClient = FakeBootstrapApiClient { DeviceBootstrapResult(deviceId = "server-issued-device-id", status = "ACTIVE") }
        val c = coordinator(apiClient, TestConformanceDeviceKeyPairGenerator(), familyStateStore, pendingAttemptStore)
        c.submitInvitationLink(LINK)

        c.beginBootstrap()

        assertEquals(EnrollmentState.BootstrapResultUnknown, c.state.value)
        assertNull(familyStateStore.currentState())
        assertNotNull(pendingAttemptStore.current())
        assertEquals(1, apiClient.callCount)
    }

    /**
     * The bootstrap response never carries a real familyId (DeviceBootstrapResult is
     * {deviceId, status, ...} only -- see EnrollmentCoordinator.persistSuccess's own doc
     * comment). Proves end-to-end, through the real coordinator flow (not a hand-constructed
     * auditor), that the committed lifecycle-audit record honestly carries `null` for familyId
     * -- never the fabricated "" placeholder that LocalFamilyState.familyId is stuck with as a
     * non-nullable storage-layer type.
     */
    @Test
    fun `persisted lifecycle audit record carries null familyId, never a fabricated empty string`() = runTest {
        val sink = InMemoryEnrollmentLifecycleAuditSink()
        val c = EnrollmentCoordinator(
            parser(),
            FakeBootstrapApiClient { DeviceBootstrapResult(deviceId = "server-issued-device-id", status = "PAIRING_PENDING") },
            TestConformanceDeviceKeyPairGenerator(),
            PersistentFamilyStateStore(InMemoryPersistentStateStore()),
            InMemoryPendingEnrollmentAttemptStore(),
            lifecycleAuditSink = sink,
        )
        c.submitInvitationLink(LINK)
        c.beginBootstrap()

        c.confirmProfile()

        assertEquals(EnrollmentState.PairingPending("server-issued-device-id"), c.state.value)
        assertEquals(1, sink.records.size)
        val record = sink.records.single()
        assertNull(record.familyId)
        assertEquals("server-issued-device-id", record.deviceId)
        assertEquals(PairingState.PAIRING_PENDING, record.toState)
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
        firstProcess.confirmProfile()
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
    fun `server 404 preserves pending attempt and exact token for explicit idempotent retry`() = runTest {
        val apiClient = ThrowingBootstrapApiClient(BootstrapError.InvitationUnavailable)
        val pendingAttemptStore = InMemoryPendingEnrollmentAttemptStore()
        val custody = EnrollmentCustodyCounter()
        val keyGenerator = CountingKeyPairGenerator(custody)
        val c = coordinator(apiClient, keyGenerator, pendingAttemptStore = pendingAttemptStore)
        c.submitInvitationLink(LINK)

        c.beginBootstrap()

        assertEquals(EnrollmentState.BootstrapResultUnknown, c.state.value)
        val attempt = pendingAttemptStore.current() ?: error("the submitted attempt must remain durable after a generic 404")
        assertTrue(custody.deleted.isEmpty())
        assertEquals(1, keyGenerator.signingCallCount)
        assertEquals(1, keyGenerator.encryptionCallCount)
        assertEquals(1, apiClient.callCount)

        // A user-directed retry preserves the same server id, invitation token, and hardware keys.
        // The coordinator never starts the replay by itself.
        c.retryBootstrap()
        assertEquals(EnrollmentState.BootstrapResultUnknown, c.state.value)
        assertEquals(attempt, pendingAttemptStore.current())
        assertTrue(custody.deleted.isEmpty())
        assertEquals(1, keyGenerator.signingCallCount)
        assertEquals(1, keyGenerator.encryptionCallCount)
        assertEquals(listOf(attempt.attemptId, attempt.attemptId), apiClient.attemptIdsSeen)
        assertEquals(listOf(LINK.substringAfter("token="), LINK.substringAfter("token=")), apiClient.rawTokensSeen)
        assertEquals(2, apiClient.callCount)
    }

    @Test
    fun `beginBootstrap alone never retries a generic invitation 404`() = runTest {
        val apiClient = ThrowingBootstrapApiClient(BootstrapError.InvitationUnavailable)
        val pendingAttemptStore = InMemoryPendingEnrollmentAttemptStore()
        val c = coordinator(apiClient, TestConformanceDeviceKeyPairGenerator(), pendingAttemptStore = pendingAttemptStore)
        c.submitInvitationLink(LINK)
        c.beginBootstrap()

        c.beginBootstrap()
        assertEquals(EnrollmentState.BootstrapResultUnknown, c.state.value)
        assertNotNull(pendingAttemptStore.current())
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
    fun `malformed HTTP profile response preserves bootstrap custody without publishing profile`() = runTest {
        val family = PersistentFamilyStateStore(InMemoryPersistentStateStore())
        val pending = InMemoryPendingEnrollmentAttemptStore()
        val pendingAtBootstrapRequest = AtomicReference<PendingEnrollmentAttempt?>()
        val fake = FakeHttpServer.start()
        fake.startRequest { request ->
            if (request.path == "/v1/enrollment/bootstrap") {
                pendingAtBootstrapRequest.set(pending.current())
            }
            when (request.path) {
                "/v1/enrollment/bootstrap/prepare" -> 200 to """{"status":"READY"}""".toByteArray()
                "/v1/enrollment/bootstrap" -> 201 to """{"deviceId":"device-123","status":"PAIRING_PENDING","signingKeyId":"dsk-123","encryptionKeyId":"dek-123","ageUxTier":"TEEN","childProfileId":null}""".toByteArray()
                else -> 500 to ByteArray(0)
            }
        }
        val apiClient = HttpDeviceBootstrapApiClient(
            BootstrapEndpointConfig(fake.baseUrl, allowInsecureHttp = true),
        )
        val custody = EnrollmentCustodyCounter()
        val c = coordinator(apiClient, custody, family, pending)

        try {
            c.submitInvitationLink(LINK)
            c.beginBootstrap()

            assertEquals(EnrollmentState.BootstrapResultUnknown, c.state.value)
            val attemptAtRequest = requireNotNull(pendingAtBootstrapRequest.get())
            assertEquals(PendingEnrollmentAttemptStatus.BOOTSTRAPPING, attemptAtRequest.status)
            assertEquals(attemptAtRequest, pending.current())
            assertNull(family.currentState())
            assertTrue(c.state.value !is EnrollmentState.ProfileConfirmation)
            assertTrue(custody.deleted.isEmpty())
        } finally {
            fake.stop()
        }
    }

    @Test
    fun `bootstrap HTTP 400 retains custody and explicit retry reuses the same request tuple`() = runTest {
        var callCount = 0
        val requests = mutableListOf<List<String>>()
        val apiClient = object : DeviceBootstrapApiClient {
            override suspend fun bootstrap(
                rawInvitationToken: String,
                platform: String,
                signingPublicKeyBase64: String,
                encryptionPublicKeyBase64: String,
                bootstrapAttemptId: String,
                attemptRecoveryToken: String,
            ): DeviceBootstrapResult {
                requests += listOf(rawInvitationToken, platform, signingPublicKeyBase64,
                    encryptionPublicKeyBase64, bootstrapAttemptId, attemptRecoveryToken)
                callCount++
                if (callCount == 1) throw BootstrapError.InvalidRequest
                return DeviceBootstrapResult("device-after-retry", "PAIRING_PENDING")
            }

            override suspend fun recoverAttempt(bootstrapAttemptId: String, attemptRecoveryToken: String): DeviceBootstrapResult =
                throw AssertionError("recovery must not be called by same-process bootstrap retry")
        }
        val pendingAttemptStore = InMemoryPendingEnrollmentAttemptStore()
        val custody = EnrollmentCustodyCounter()
        val c = coordinator(apiClient, custody, pendingAttemptStore = pendingAttemptStore)
        c.submitInvitationLink(LINK)

        c.beginBootstrap()

        val original = pendingAttemptStore.current()
        assertEquals(EnrollmentState.BootstrapResultUnknown, c.state.value)
        assertNotNull(original)
        assertTrue(custody.deleted.isEmpty())

        c.retryBootstrap()

        assertTrue(c.state.value is EnrollmentState.ProfileConfirmation)
        assertEquals(2, callCount)
        assertEquals(requests[0], requests[1])
        assertEquals(original, pendingAttemptStore.current())
        assertEquals(1, custody.signingGenerations)
        assertEquals(1, custody.encryptionGenerations)
        assertTrue(custody.deleted.isEmpty())
    }

    @Test
    fun `unknown bootstrap can recover authoritative abandonment before a fresh tuple is created`() = runTest {
        val pending = InMemoryPendingEnrollmentAttemptStore()
        val custody = EnrollmentCustodyCounter()
        val family = PersistentFamilyStateStore(InMemoryPersistentStateStore())
        val bootstrapTuples = mutableListOf<List<String>>()
        var prepareCalls = 0
        var recoveryCalls = 0
        val api = object : DeviceBootstrapApiClient {
            override suspend fun prepareAttempt(
                rawInvitationToken: String,
                platform: String,
                signingPublicKeyBase64: String,
                encryptionPublicKeyBase64: String,
                bootstrapAttemptId: String,
                attemptRecoveryToken: String,
            ) {
                prepareCalls++
            }

            override suspend fun bootstrap(
                rawInvitationToken: String,
                platform: String,
                signingPublicKeyBase64: String,
                encryptionPublicKeyBase64: String,
                bootstrapAttemptId: String,
                attemptRecoveryToken: String,
            ): DeviceBootstrapResult {
                bootstrapTuples += listOf(
                    rawInvitationToken,
                    platform,
                    signingPublicKeyBase64,
                    encryptionPublicKeyBase64,
                    bootstrapAttemptId,
                    attemptRecoveryToken,
                )
                if (bootstrapTuples.size == 1) throw BootstrapError.InvalidRequest
                return DeviceBootstrapResult(
                    "fresh-device",
                    "PAIRING_PENDING",
                    signingKeyId = "fresh-signing-key-id",
                    encryptionKeyId = "fresh-encryption-key-id",
                )
            }

            override suspend fun recoverAttempt(
                bootstrapAttemptId: String,
                attemptRecoveryToken: String,
            ): DeviceBootstrapResult {
                recoveryCalls++
                assertEquals(pending.current()?.attemptId, bootstrapAttemptId)
                assertEquals(pending.current()?.attemptRecoveryToken, attemptRecoveryToken)
                throw RecoveryError.AttemptAbandoned
            }
        }
        val c = coordinator(
            api,
            custody,
            familyStateStore = family,
            pendingAttemptStore = pending,
            firstDeviceRootStore = org.pca.app.firstdevice.InMemoryFirstDeviceRootStore(),
        )
        c.submitInvitationLink(LINK)
        c.beginBootstrap()
        val abandoned = pending.current()!!
        assertEquals(EnrollmentState.BootstrapResultUnknown, c.state.value)

        c.recoverAttempt()

        assertEquals(1, recoveryCalls)
        assertEquals(1, bootstrapTuples.size)
        assertEquals(EnrollmentState.NotEnrolled, c.state.value)
        assertNull(pending.current())
        assertEquals(listOf(abandoned.signingPrivateKeyAlias, abandoned.encryptionPrivateKeyAlias), custody.deleted)

        c.submitInvitationLink(LINK)
        c.beginBootstrap()

        assertEquals(2, prepareCalls)
        assertEquals(2, bootstrapTuples.size)
        assertNotEquals(bootstrapTuples[0][4], bootstrapTuples[1][4])
        assertNotEquals(bootstrapTuples[0][5], bootstrapTuples[1][5])
        assertNotEquals(bootstrapTuples[0][2], bootstrapTuples[1][2])
        assertNotEquals(bootstrapTuples[0][3], bootstrapTuples[1][3])
        assertTrue(c.state.value is EnrollmentState.ProfileConfirmation)
        assertEquals("fresh-device", (c.state.value as EnrollmentState.ProfileConfirmation).deviceId)
        assertEquals(PendingEnrollmentAttemptStatus.BOOTSTRAPPING, pending.current()?.status)
        assertTrue(custody.deleted.contains(abandoned.signingPrivateKeyAlias))
        assertTrue(custody.deleted.contains(abandoned.encryptionPrivateKeyAlias))
        c.confirmProfile()
        assertEquals(EnrollmentState.PairingPending("fresh-device"), c.state.value)
        assertEquals("fresh-device", family.currentState()?.deviceId)
        assertNull(pending.current())
    }

    @Test
    fun `an ordinary server failure (5xx) preserves the pending attempt for a later retry`() = runTest {
        val apiClient = ThrowingBootstrapApiClient(BootstrapError.UnexpectedServerError)
        val pendingAttemptStore = InMemoryPendingEnrollmentAttemptStore()
        val c = coordinator(apiClient, TestConformanceDeviceKeyPairGenerator(), pendingAttemptStore = pendingAttemptStore)
        c.submitInvitationLink(LINK)

        c.beginBootstrap()

        assertEquals(EnrollmentState.FailedRetryable, c.state.value)
        val original = pendingAttemptStore.current()!!
        c.retryBootstrap()

        assertEquals(EnrollmentState.FailedRetryable, c.state.value)
        assertEquals(original, pendingAttemptStore.current())
        assertEquals(listOf(original.attemptId, original.attemptId), apiClient.attemptIdsSeen)
        assertEquals(listOf(LINK.substringAfter("token="), LINK.substringAfter("token=")), apiClient.rawTokensSeen)
        assertEquals(2, apiClient.callCount)
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

        assertEquals(VALID_LINK_TOKEN, apiClient.lastRawToken)
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
        c.confirmProfile()
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
        c.confirmProfile()

        assertEquals(EnrollmentState.PairingPending("recovered-device-id"), c.state.value)
        assertEquals("recovered-device-id", familyStateStore.currentState()?.deviceId)
        assertEquals(1, apiClient.recoverCallCount)
        assertEquals("attempt-recover-1", apiClient.lastAttemptId)
        assertEquals("recovery-secret-1", apiClient.lastRecoveryToken)
        assertNull(pendingAttemptStore.current())
    }

    @Test
    fun `recoverAttempt 404 preserves unresolved attempt and key custody -- no false terminal answer or automatic retry`() = runTest {
        val pendingAttemptStore = InMemoryPendingEnrollmentAttemptStore()
        val unresolved = org.pca.app.storage.PendingEnrollmentAttempt(
            "attempt-x", "secret-x", "https://api.pca.app", "ANDROID", "dsk", "dsk-alias", "dek", "dek-alias",
            org.pca.app.storage.PendingEnrollmentAttemptStatus.RESULT_UNKNOWN,
        )
        pendingAttemptStore.save(unresolved)
        val apiClient = ThrowingRecoveryApiClient(RecoveryError.NotFound)
        val custody = EnrollmentCustodyCounter()
        val c = EnrollmentCoordinator(parser(), apiClient, custody, PersistentFamilyStateStore(InMemoryPersistentStateStore()), pendingAttemptStore)
        assertTrue(c.state.value is EnrollmentState.RecoveryPending)

        c.recoverAttempt()

        assertEquals(EnrollmentState.RecoveryPending("https://api.pca.app"), c.state.value)
        assertEquals(unresolved, pendingAttemptStore.current())
        assertTrue(custody.deleted.isEmpty())
        assertEquals(listOf("attempt-x"), apiClient.attemptIdsSeen)
        assertEquals(listOf("secret-x"), apiClient.recoveryTokensSeen)
        assertEquals(1, apiClient.recoverCallCount)

        // A later explicit recovery uses the same durable capability; the coordinator never
        // turns a 404 into an automatic retry loop or releases these keys.
        c.recoverAttempt()
        assertEquals(EnrollmentState.RecoveryPending("https://api.pca.app"), c.state.value)
        assertEquals(unresolved, pendingAttemptStore.current())
        assertTrue(custody.deleted.isEmpty())
        assertEquals(listOf("attempt-x", "attempt-x"), apiClient.attemptIdsSeen)
        assertEquals(listOf("secret-x", "secret-x"), apiClient.recoveryTokensSeen)
        assertEquals(2, apiClient.recoverCallCount)
    }

    @Test
    fun `prepared attempt restart recovery 404 keeps custody until exact link is rescanned and same attempt is retried`() = runTest {
        val pendingAttemptStore = InMemoryPendingEnrollmentAttemptStore()
        val unresolved = retainedAttempt(VALID_LINK_TOKEN).copy(status = PendingEnrollmentAttemptStatus.PREPARED)
        pendingAttemptStore.save(unresolved)
        val custody = EnrollmentCustodyCounter()
        val calls = mutableListOf<String>()
        val api = object : DeviceBootstrapApiClient {
            override suspend fun prepareAttempt(
                rawInvitationToken: String,
                platform: String,
                signingPublicKeyBase64: String,
                encryptionPublicKeyBase64: String,
                bootstrapAttemptId: String,
                attemptRecoveryToken: String,
            ) {
                assertEquals(VALID_LINK_TOKEN, rawInvitationToken)
                assertEquals(unresolved.platform, platform)
                assertEquals(unresolved.signingPublicKeyBase64, signingPublicKeyBase64)
                assertEquals(unresolved.encryptionPublicKeyBase64, encryptionPublicKeyBase64)
                assertEquals(unresolved.attemptId, bootstrapAttemptId)
                assertEquals(unresolved.attemptRecoveryToken, attemptRecoveryToken)
                calls += "prepare:$bootstrapAttemptId"
            }

            override suspend fun bootstrap(
                rawInvitationToken: String,
                platform: String,
                signingPublicKeyBase64: String,
                encryptionPublicKeyBase64: String,
                bootstrapAttemptId: String,
                attemptRecoveryToken: String,
            ): DeviceBootstrapResult {
                assertEquals(VALID_LINK_TOKEN, rawInvitationToken)
                assertEquals(unresolved.platform, platform)
                assertEquals(unresolved.signingPublicKeyBase64, signingPublicKeyBase64)
                assertEquals(unresolved.encryptionPublicKeyBase64, encryptionPublicKeyBase64)
                assertEquals(unresolved.attemptId, bootstrapAttemptId)
                assertEquals(unresolved.attemptRecoveryToken, attemptRecoveryToken)
                calls += "bootstrap:$bootstrapAttemptId"
                return DeviceBootstrapResult("device-after-rescan", "PAIRING_PENDING")
            }

            override suspend fun recoverAttempt(bootstrapAttemptId: String, attemptRecoveryToken: String): DeviceBootstrapResult {
                calls += "recover:$bootstrapAttemptId"
                throw RecoveryError.NotFound
            }
        }
        val c = coordinator(api, custody, pendingAttemptStore = pendingAttemptStore)

        assertEquals(EnrollmentState.RecoveryPending("https://api.pca.app"), c.state.value)
        c.recoverAttempt()

        assertEquals(EnrollmentState.RecoveryPending("https://api.pca.app"), c.state.value)
        assertEquals(unresolved, pendingAttemptStore.current())
        assertTrue(custody.deleted.isEmpty())
        assertEquals(listOf("recover:${unresolved.attemptId}"), calls)

        c.submitInvitationLink(LINK)
        assertEquals(EnrollmentState.BootstrapResultUnknown, c.state.value)
        c.retryBootstrap()

        assertEquals(listOf("recover:${unresolved.attemptId}", "prepare:${unresolved.attemptId}", "bootstrap:${unresolved.attemptId}"), calls)
        assertEquals(PendingEnrollmentAttemptStatus.BOOTSTRAPPING, pendingAttemptStore.current()?.status)
        assertTrue(custody.deleted.isEmpty())
        assertEquals("device-after-rescan", (c.state.value as EnrollmentState.ProfileConfirmation).deviceId)
    }

    @Test
    fun `recoverAttempt with authoritative abandonment clears only that attempt and its two aliases`() = runTest {
        val pendingStore = InMemoryPendingEnrollmentAttemptStore()
        val attempt = retainedAttempt()
        pendingStore.save(attempt)
        val custody = EnrollmentCustodyCounter()
        val api = ThrowingRecoveryApiClient(RecoveryError.AttemptAbandoned)
        val c = coordinator(
            api,
            custody,
            PersistentFamilyStateStore(InMemoryPersistentStateStore()),
            pendingStore,
            org.pca.app.firstdevice.InMemoryFirstDeviceRootStore(),
        )

        c.recoverAttempt()

        assertEquals(EnrollmentState.NotEnrolled, c.state.value)
        assertNull(pendingStore.current())
        assertEquals(listOf(attempt.signingPrivateKeyAlias, attempt.encryptionPrivateKeyAlias), custody.deleted)
    }

    @Test
    fun `abandonment cleanup never deletes aliases after pending ownership changes before CAS`() = runTest {
        val attempt = retainedAttempt()
        val replacementAttempt = attempt.copy(
            attemptId = "replacement",
            signingPrivateKeyAlias = "replacement-signing",
            encryptionPrivateKeyAlias = "replacement-encryption",
        )
        val backing = InMemoryPendingEnrollmentAttemptStore().apply { save(attempt) }
        val pending = object : PendingEnrollmentAttemptStore by backing {
            override fun compareAndSet(
                expected: PendingEnrollmentAttempt?,
                replacement: PendingEnrollmentAttempt?,
            ): Boolean {
                if (expected == attempt && replacement == null) {
                    backing.save(replacementAttempt)
                    return false
                }
                return backing.compareAndSet(expected, replacement)
            }
        }
        val custody = EnrollmentCustodyCounter()
        val c = coordinator(
            ThrowingRecoveryApiClient(RecoveryError.AttemptAbandoned),
            custody,
            pendingAttemptStore = pending,
            firstDeviceRootStore = org.pca.app.firstdevice.InMemoryFirstDeviceRootStore(),
        )

        c.recoverAttempt()

        assertEquals(replacementAttempt, pending.current())
        assertTrue(custody.deleted.isEmpty())
        assertEquals(EnrollmentState.LocalPersistenceUnavailable, c.state.value)
    }

    @Test
    fun `authoritative abandonment preserves aliases already owned by the same first-device root`() = runTest {
        val pending = InMemoryPendingEnrollmentAttemptStore()
        val attempt = retainedAttempt()
        pending.save(attempt)
        val rootStore = org.pca.app.firstdevice.InMemoryFirstDeviceRootStore()
        val root = org.pca.app.firstdevice.FirstDeviceRootRecord(
            seed = org.pca.app.firstdevice.FirstDeviceCeremonySeed(
                attempt.attemptId,
                attempt.attemptRecoveryToken,
                attempt.serverBaseUrl,
                "device-root",
                "signing-id",
                "encryption-id",
                attempt.signingPublicKeyBase64,
                attempt.encryptionPublicKeyBase64,
                attempt.signingPrivateKeyAlias,
                attempt.encryptionPrivateKeyAlias,
            ),
        )
        assertTrue(rootStore.captureSeed(root, emptySet()))
        val custody = EnrollmentCustodyCounter()
        val c = coordinator(
            ThrowingRecoveryApiClient(RecoveryError.AttemptAbandoned),
            custody,
            pendingAttemptStore = pending,
            firstDeviceRootStore = rootStore,
        )

        c.recoverAttempt()

        assertEquals(attempt, pending.current())
        assertEquals(EnrollmentState.RecoveryPending(attempt.serverBaseUrl, custodyConflict = true), c.state.value)
        assertTrue(custody.deleted.isEmpty())
        assertEquals(root, rootStore.current())
    }

    @Test
    fun `authoritative abandonment preserves aliases when first-device root state is unreadable`() = runTest {
        val pending = InMemoryPendingEnrollmentAttemptStore()
        val attempt = retainedAttempt()
        pending.save(attempt)
        val unreadableRootStore = object : org.pca.app.firstdevice.FirstDeviceRootStore by
            org.pca.app.firstdevice.InMemoryFirstDeviceRootStore() {
            override fun readState(): org.pca.app.firstdevice.FirstDeviceRootReadResult =
                org.pca.app.firstdevice.FirstDeviceRootReadResult.Unreadable

            override fun withConfirmedSafeAttemptKeyCleanup(attemptId: String, cleanup: () -> Unit): Boolean = false
        }
        val custody = EnrollmentCustodyCounter()
        val c = coordinator(
            ThrowingRecoveryApiClient(RecoveryError.AttemptAbandoned),
            custody,
            pendingAttemptStore = pending,
            firstDeviceRootStore = unreadableRootStore,
        )

        c.recoverAttempt()

        assertEquals(attempt, pending.current())
        assertEquals(EnrollmentState.RecoveryPending(attempt.serverBaseUrl, custodyConflict = true), c.state.value)
        assertTrue(custody.deleted.isEmpty())
    }

    @Test
    fun `authoritative abandonment without a root store remains recoverable custody conflict`() = runTest {
        val pending = InMemoryPendingEnrollmentAttemptStore()
        val attempt = retainedAttempt()
        pending.save(attempt)
        val custody = EnrollmentCustodyCounter()
        val c = coordinator(
            ThrowingRecoveryApiClient(RecoveryError.AttemptAbandoned),
            custody,
            pendingAttemptStore = pending,
        )

        c.recoverAttempt()

        assertEquals(attempt, pending.current())
        assertEquals(EnrollmentState.RecoveryPending(attempt.serverBaseUrl, custodyConflict = true), c.state.value)
        assertTrue(custody.deleted.isEmpty())
    }

    @Test
    fun `exact rescan in custody conflict remains recovery-only and keeps warning after a 404`() = runTest {
        val pending = InMemoryPendingEnrollmentAttemptStore()
        val attempt = retainedAttempt(VALID_LINK_TOKEN)
        pending.save(attempt)
        val api = object : DeviceBootstrapApiClient {
            var recoveryCalls = 0
            var bootstrapCalls = 0
            override suspend fun bootstrap(
                rawInvitationToken: String,
                platform: String,
                signingPublicKeyBase64: String,
                encryptionPublicKeyBase64: String,
                bootstrapAttemptId: String,
                attemptRecoveryToken: String,
            ): DeviceBootstrapResult {
                bootstrapCalls++
                throw AssertionError("custody conflict must never replay bootstrap")
            }

            override suspend fun recoverAttempt(bootstrapAttemptId: String, attemptRecoveryToken: String): DeviceBootstrapResult {
                recoveryCalls++
                if (recoveryCalls == 1) throw RecoveryError.AttemptAbandoned
                throw RecoveryError.NotFound
            }
        }
        val c = coordinator(api, pendingAttemptStore = pending)

        c.recoverAttempt()
        assertEquals(EnrollmentState.RecoveryPending(attempt.serverBaseUrl, custodyConflict = true), c.state.value)
        c.submitInvitationLink("pca://enroll?token=$OTHER_VALID_LINK_TOKEN")
        assertEquals(EnrollmentState.RecoveryPending(attempt.serverBaseUrl, invitationRescanRejected = true, custodyConflict = true), c.state.value)

        c.submitInvitationLink(LINK)
        assertEquals(EnrollmentState.RecoveryPending(attempt.serverBaseUrl, custodyConflict = true), c.state.value)
        c.recoverAttempt()

        assertEquals(EnrollmentState.RecoveryPending(attempt.serverBaseUrl, custodyConflict = true), c.state.value)
        assertEquals(attempt, pending.current())
        assertEquals(2, api.recoveryCalls)
        assertEquals(0, api.bootstrapCalls)
    }

    @Test
    fun `rejected prepare resolves an unsent attempt and a recovery 404 releases it for a different invite`() = runTest {
        val pending = InMemoryPendingEnrollmentAttemptStore()
        val custody = EnrollmentCustodyCounter()
        val api = RejectedPrepareApiClient(RecoveryError.NotFound)
        val c = coordinator(
            api,
            custody,
            pendingAttemptStore = pending,
            firstDeviceRootStore = org.pca.app.firstdevice.InMemoryFirstDeviceRootStore(),
        )
        c.submitInvitationLink(LINK)

        c.beginBootstrap()

        assertEquals(1, api.prepareCalls)
        assertEquals(1, api.recoveryCalls)
        assertEquals(0, api.bootstrapCalls)
        assertNull(pending.current())
        assertEquals(EnrollmentState.NotEnrolled, c.state.value)
        assertEquals(custody.generatedAliases, custody.deleted)
        c.submitInvitationLink("pca://enroll?token=$OTHER_VALID_LINK_TOKEN")
        assertTrue(c.state.value is EnrollmentState.InvitationReady)
    }

    @Test
    fun `unrecognized prepare 404 preserves the exact prepared attempt and generated key custody`() = runTest {
        val calls = AtomicReference<List<String>>(emptyList())
        val fake = FakeHttpServer.start()
        fake.startRequest { request ->
            calls.updateAndGet { it + request.path }
            404 to """{"error":"invitation_unavailable","proxy":"not found"}""".toByteArray()
        }
        val pending = InMemoryPendingEnrollmentAttemptStore()
        val custody = EnrollmentCustodyCounter()
        val api = HttpDeviceBootstrapApiClient(
            BootstrapEndpointConfig(baseUrl = fake.baseUrl, allowInsecureHttp = true),
        )
        val c = coordinator(
            api,
            custody,
            pendingAttemptStore = pending,
            firstDeviceRootStore = org.pca.app.firstdevice.InMemoryFirstDeviceRootStore(),
        )
        try {
            c.submitInvitationLink(LINK)
            c.beginBootstrap()

            val attempt = pending.current()
            assertNotNull(attempt)
            assertEquals(PendingEnrollmentAttemptStatus.PREPARED, attempt!!.status)
            assertEquals(EnrollmentState.BootstrapResultUnknown, c.state.value)
            assertEquals(listOf("/v1/enrollment/bootstrap/prepare"), calls.get())
            assertEquals(
                setOf(attempt.signingPrivateKeyAlias, attempt.encryptionPrivateKeyAlias),
                custody.generatedAliases.toSet(),
            )
            assertTrue(custody.deleted.isEmpty())
        } finally {
            fake.stop()
        }
    }

    @Test
    fun `canonical prepare 404 followed by unrecognized recovery 404 preserves the unsent attempt`() = runTest {
        val calls = AtomicReference<List<String>>(emptyList())
        val fake = FakeHttpServer.start()
        fake.startRequest { request ->
            calls.updateAndGet { it + request.path }
            val body = when (request.path) {
                "/v1/enrollment/bootstrap/prepare" -> """{"error":"invitation_unavailable"}"""
                "/v1/enrollment/bootstrap/recover" -> """{"error":"invitation_unavailable","route":"missing"}"""
                else -> "unexpected route"
            }
            404 to body.toByteArray()
        }
        val pending = InMemoryPendingEnrollmentAttemptStore()
        val custody = EnrollmentCustodyCounter()
        val api = HttpDeviceBootstrapApiClient(
            BootstrapEndpointConfig(baseUrl = fake.baseUrl, allowInsecureHttp = true),
        )
        val c = coordinator(
            api,
            custody,
            pendingAttemptStore = pending,
            firstDeviceRootStore = org.pca.app.firstdevice.InMemoryFirstDeviceRootStore(),
        )
        try {
            c.submitInvitationLink(LINK)
            c.beginBootstrap()

            val attempt = pending.current()
            assertNotNull(attempt)
            assertEquals(PendingEnrollmentAttemptStatus.PREPARED, attempt!!.status)
            assertTrue(c.state.value is EnrollmentState.RecoveryPending)
            assertEquals(
                listOf("/v1/enrollment/bootstrap/prepare", "/v1/enrollment/bootstrap/recover"),
                calls.get(),
            )
            assertEquals(
                setOf(attempt.signingPrivateKeyAlias, attempt.encryptionPrivateKeyAlias),
                custody.generatedAliases.toSet(),
            )
            assertTrue(custody.deleted.isEmpty())
        } finally {
            fake.stop()
        }
    }

    @Test
    fun `abandoned attempt deletion continues to the second key alias after the first deletion throws`() = runTest {
        val pending = InMemoryPendingEnrollmentAttemptStore()
        val attempt = retainedAttempt()
        pending.save(attempt)
        val custody = EnrollmentCustodyCounter().apply { failingAlias = attempt.signingPrivateKeyAlias }
        val c = coordinator(
            ThrowingRecoveryApiClient(RecoveryError.AttemptAbandoned),
            custody,
            pendingAttemptStore = pending,
            firstDeviceRootStore = org.pca.app.firstdevice.InMemoryFirstDeviceRootStore(),
        )

        c.recoverAttempt()

        assertNull(pending.current())
        assertEquals(EnrollmentState.NotEnrolled, c.state.value)
        assertEquals(listOf(attempt.encryptionPrivateKeyAlias), custody.deleted)
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
    fun `malformed recovery HTTP profile response preserves exact attempt and key custody`() = runTest {
        val attempt = PendingEnrollmentAttempt(
            "attempt-malformed-recovery", "recovery-secret", "https://api.pca.app", "ANDROID",
            "dsk-public", "dsk-alias", "dek-public", "dek-alias",
            PendingEnrollmentAttemptStatus.RESULT_UNKNOWN,
        )
        val pending = InMemoryPendingEnrollmentAttemptStore().apply { save(attempt) }
        val family = PersistentFamilyStateStore(InMemoryPersistentStateStore())
        val custody = EnrollmentCustodyCounter()
        val fake = FakeHttpServer.start()
        fake.start { 200 to """{"deviceId":"device-123","status":"PAIRING_PENDING","signingKeyId":"dsk-123","encryptionKeyId":"dek-123","initialPolicyProfile":"STRICT","childProfileId":null}""".toByteArray() }
        val apiClient = HttpDeviceBootstrapApiClient(
            BootstrapEndpointConfig(fake.baseUrl, allowInsecureHttp = true),
        )
        val c = coordinator(apiClient, custody, family, pending)

        try {
            c.recoverAttempt()

            assertEquals(EnrollmentState.RecoveryPending(attempt.serverBaseUrl), c.state.value)
            assertEquals(attempt, pending.current())
            assertNull(family.currentState())
            assertTrue(c.state.value !is EnrollmentState.ProfileConfirmation)
            assertTrue(custody.deleted.isEmpty())
        } finally {
            fake.stop()
        }
    }

    @Test
    fun `recoverAttempt with no pending attempt on record is a safe no-op`() = runTest {
        val c = coordinator(NeverCalledBootstrapApiClient())
        c.recoverAttempt()
        assertEquals(EnrollmentState.FailedInvitationInvalid, c.state.value)
    }

    // --- PCA-FR-140/141: local device-key fingerprint exposure ---

    @Test
    fun `keyFingerprints is null before any bootstrap attempt`() {
        val c = coordinator(NeverCalledBootstrapApiClient())
        assertNull(c.keyFingerprints.value)
        c.submitInvitationLink(LINK)
        assertNull(c.keyFingerprints.value)
    }

    @Test
    fun `keyFingerprints is populated locally from the generated keys BEFORE the network call, and matches computeKeyFingerprint`() = runTest {
        val apiClient = FakeBootstrapApiClient { DeviceBootstrapResult("d1", "PAIRING_PENDING") }
        val keyGen = TestConformanceDeviceKeyPairGenerator()
        val c = coordinator(apiClient, keyGen)
        c.submitInvitationLink(LINK)

        c.beginBootstrap()
        c.confirmProfile()

        val fingerprints = c.keyFingerprints.value
        assertTrue(fingerprints != null)
        assertTrue(fingerprints!!.signingKeyFingerprint.isNotBlank())
        assertTrue(fingerprints.encryptionKeyFingerprint.isNotBlank())
        assertNotEquals(fingerprints.signingKeyFingerprint, fingerprints.encryptionKeyFingerprint)
    }

    @Test
    fun `keyFingerprints stays null when the crypto gate blocks bootstrap -- never fabricated ahead of real key generation`() = runTest {
        val c = coordinator(NeverCalledBootstrapApiClient())
        c.submitInvitationLink(LINK)

        c.beginBootstrap()

        assertEquals(EnrollmentState.CryptoReviewRequired, c.state.value)
        assertNull(c.keyFingerprints.value)
    }

    @Test
    fun `keyFingerprints is cleared when a fresh link is submitted for a second device -- never leaks a prior device's fingerprint`() = runTest {
        val apiClient = FakeBootstrapApiClient { DeviceBootstrapResult("d1", "PAIRING_PENDING") }
        val c = coordinator(apiClient, TestConformanceDeviceKeyPairGenerator())
        c.submitInvitationLink(LINK)
        c.beginBootstrap()
        c.confirmProfile()
        assertTrue(c.keyFingerprints.value != null)

        // Add-another-device path: a fresh link submission must not keep showing the first
        // device's fingerprint while the second device's keys are not yet generated.
        c.submitInvitationLink(LINK)
        assertNull(c.keyFingerprints.value)
    }

    @Test
    fun `two different key pairs produce two different fingerprint sets`() = runTest {
        val apiClient = FakeBootstrapApiClient { DeviceBootstrapResult("d1", "PAIRING_PENDING") }
        // A single shared key generator instance across two coordinators, so its internal
        // uniqueness counter guarantees the second device's keys are genuinely distinct from the
        // first's (rather than two independently-constructed generators each starting their own
        // counter at 0, which would coincidentally produce identical fake key bytes).
        val sharedKeyGen = TestConformanceDeviceKeyPairGenerator()
        val c1 = coordinator(apiClient, sharedKeyGen)
        c1.submitInvitationLink(LINK)
        c1.beginBootstrap()
        val first = c1.keyFingerprints.value!!

        val c2 = coordinator(apiClient, sharedKeyGen)
        c2.submitInvitationLink(LINK)
        c2.beginBootstrap()
        val second = c2.keyFingerprints.value!!

        assertNotEquals(first.signingKeyFingerprint, second.signingKeyFingerprint)
        assertNotEquals(first.encryptionKeyFingerprint, second.encryptionKeyFingerprint)
    }

    @Test
    fun `two independent beginBootstrap calls (two genuinely different attempts) generate DIFFERENT attemptIds`() = runTest {
        val apiClient = FakeBootstrapApiClient { DeviceBootstrapResult("d", "PAIRING_PENDING") }
        val c = coordinator(apiClient, TestConformanceDeviceKeyPairGenerator())
        c.submitInvitationLink(LINK)
        c.beginBootstrap()
        c.confirmProfile()
        val firstAttemptId = apiClient.attemptIdsSeen.single()

        // A second, independent enrollment attempt (e.g. after successfully pairing this device
        // and later re-enrolling, or a fresh submitInvitationLink) must never reuse the prior
        // attemptId.
        c.submitInvitationLink(LINK)
        c.beginBootstrap()

        assertEquals(2, apiClient.attemptIdsSeen.size)
        assertNotEquals(firstAttemptId, apiClient.attemptIdsSeen[1])
    }

    private fun invitationDigest(token: String): String = MessageDigest.getInstance("SHA-256")
        .digest(token.toByteArray(Charsets.UTF_8))
        .joinToString("") { "%02x".format(it.toInt() and 0xff) }

    private fun retainedAttempt(invitationToken: String? = null) = org.pca.app.storage.PendingEnrollmentAttempt(
        "retained", "secret", "https://api.pca.app", "ANDROID", "dsk", "dsk-alias",
        "dek", "dek-alias", org.pca.app.storage.PendingEnrollmentAttemptStatus.RESULT_UNKNOWN,
        invitationTokenSha256 = invitationToken?.let(::invitationDigest),
    )

    private class SuspendedApi : DeviceBootstrapApiClient {
        val response = CompletableDeferred<DeviceBootstrapResult>()
        var bootstrapCalls = 0
        var recoveryCalls = 0
        override suspend fun bootstrap(rawInvitationToken: String, platform: String, signingPublicKeyBase64: String,
            encryptionPublicKeyBase64: String, bootstrapAttemptId: String, attemptRecoveryToken: String): DeviceBootstrapResult {
            bootstrapCalls++
            return response.await()
        }
        override suspend fun recoverAttempt(bootstrapAttemptId: String, attemptRecoveryToken: String): DeviceBootstrapResult {
            recoveryCalls++
            return response.await()
        }
    }

    @Test
    fun `suspended bootstrap rejects replacement duplicate operations and confirmation`() = runTest {
        val api = SuspendedApi()
        val pending = InMemoryPendingEnrollmentAttemptStore()
        val family = PersistentFamilyStateStore(InMemoryPersistentStateStore())
        val c = coordinator(api, TestConformanceDeviceKeyPairGenerator(), family, pending)
        c.submitInvitationLink(LINK)
        val job = launch { c.beginBootstrap() }
        runCurrent()
        val original = pending.current()
        c.submitInvitationLink("pca://enroll?token=$OTHER_VALID_LINK_TOKEN")
        c.beginBootstrap()
        c.retryBootstrap()
        c.recoverAttempt()
        c.confirmProfile()
        assertEquals(1, api.bootstrapCalls)
        assertEquals(0, api.recoveryCalls)
        assertEquals(original, pending.current())
        assertEquals(EnrollmentState.Bootstrapping, c.state.value)
        assertNull(family.currentState())
        api.response.complete(DeviceBootstrapResult("original-device", "PAIRING_PENDING"))
        job.join()
        c.confirmProfile()
        assertEquals("original-device", family.currentState()?.deviceId)
        assertNull(pending.current())
    }

    @Test
    fun `restart unresolved attempt rejects new invitation and key generation`() = runTest {
        val original = retainedAttempt(LINK.substringAfter("token="))
        val pending = InMemoryPendingEnrollmentAttemptStore().apply { save(original) }
        val keys = CountingKeyPairGenerator(TestConformanceDeviceKeyPairGenerator())
        val c = coordinator(NeverCalledBootstrapApiClient(), keys, pendingAttemptStore = pending)
        c.submitInvitationLink(LINK)
        c.beginBootstrap()
        assertEquals(original, pending.current())
        assertEquals(EnrollmentState.BootstrapResultUnknown, c.state.value)
        assertEquals(0, keys.signingCallCount)
        assertEquals(0, keys.encryptionCallCount)
    }

    @Test
    fun `restart allows explicit retry only after rescanning the exact bound invitation`() = runTest {
        val token = "A".repeat(43)
        val original = retainedAttempt(token).copy(serverBaseUrl = "pca://enroll")
        val pending = InMemoryPendingEnrollmentAttemptStore().apply { save(original) }
        val api = ThrowingBootstrapApiClient(BootstrapError.InvitationUnavailable)
        val keys = CountingKeyPairGenerator(TestConformanceDeviceKeyPairGenerator())
        val c = coordinator(api, keys, pendingAttemptStore = pending)

        assertEquals(EnrollmentState.RecoveryPending(original.serverBaseUrl), c.state.value)
        c.submitInvitationLink("pca://enroll?token=$OTHER_VALID_LINK_TOKEN")
        assertEquals(EnrollmentState.RecoveryPending(original.serverBaseUrl, invitationRescanRejected = true), c.state.value)
        assertEquals(0, api.callCount)

        val alternateRepresentation = "${EnrollmentDeepLinkConfig.APP_LINK_SCHEME}://${EnrollmentDeepLinkConfig.APP_LINK_HOST}${EnrollmentDeepLinkConfig.APP_LINK_PATH_PREFIX}$token"
        c.submitInvitationLink(alternateRepresentation)
        assertEquals(EnrollmentState.BootstrapResultUnknown, c.state.value)
        c.retryBootstrap()

        assertEquals(EnrollmentState.BootstrapResultUnknown, c.state.value)
        assertEquals(original, pending.current())
        assertEquals(listOf(token), api.rawTokensSeen)
        assertEquals(listOf(original.attemptId), api.attemptIdsSeen)
        assertEquals(0, keys.signingCallCount)
        assertEquals(0, keys.encryptionCallCount)
    }

    @Test
    fun `legacy restart record without invitation digest remains recovery only`() = runTest {
        val original = retainedAttempt()
        val pending = InMemoryPendingEnrollmentAttemptStore().apply { save(original) }
        val api = ThrowingBootstrapApiClient(BootstrapError.InvitationUnavailable)
        val c = coordinator(api, TestConformanceDeviceKeyPairGenerator(), pendingAttemptStore = pending)

        c.submitInvitationLink(LINK)

        assertEquals(EnrollmentState.RecoveryPending(original.serverBaseUrl, invitationRescanRejected = true), c.state.value)
        assertEquals(0, api.callCount)
        assertEquals(original, pending.current())
    }

    @Test
    fun `recovery status retry keeps the rejected-rescan explanation visible`() = runTest {
        val original = retainedAttempt(LINK.substringAfter("token="))
        val pending = InMemoryPendingEnrollmentAttemptStore().apply { save(original) }
        val api = ThrowingRecoveryApiClient(RecoveryError.NotFound)
        val c = coordinator(api, TestConformanceDeviceKeyPairGenerator(), pendingAttemptStore = pending)

        c.submitInvitationLink("pca://enroll?token=$OTHER_VALID_LINK_TOKEN")
        assertEquals(EnrollmentState.RecoveryPending(original.serverBaseUrl, true), c.state.value)
        c.recoverAttempt()

        assertEquals(EnrollmentState.RecoveryPending(original.serverBaseUrl, true), c.state.value)
        assertEquals(original, pending.current())
        assertEquals(1, api.recoverCallCount)
    }

    @Test
    fun `stale coordinator cannot adopt a replaced attempt during retry`() = runTest {
        val original = retainedAttempt(LINK.substringAfter("token=")).copy(serverBaseUrl = "pca://enroll")
        val replacement = original.copy(attemptId = "replacement-attempt")
        val pending = InMemoryPendingEnrollmentAttemptStore().apply { save(original) }
        val api = ThrowingBootstrapApiClient(BootstrapError.InvitationUnavailable)
        val c = coordinator(api, pendingAttemptStore = pending)

        c.submitInvitationLink(LINK)
        assertEquals(EnrollmentState.BootstrapResultUnknown, c.state.value)
        pending.save(replacement)
        c.retryBootstrap()

        assertEquals(0, api.callCount)
        assertEquals(replacement, pending.current())
        assertEquals(EnrollmentState.RecoveryPending(replacement.serverBaseUrl), c.state.value)
    }

    @Test
    fun `suspended recovery admits only one request and preserves original identity`() = runTest {
        val api = SuspendedApi()
        val original = retainedAttempt()
        val pending = InMemoryPendingEnrollmentAttemptStore().apply { save(original) }
        val family = PersistentFamilyStateStore(InMemoryPersistentStateStore())
        val c = coordinator(api, familyStateStore = family, pendingAttemptStore = pending)
        val job = launch { c.recoverAttempt() }
        runCurrent()
        c.submitInvitationLink(LINK)
        c.recoverAttempt()
        c.confirmProfile()
        assertEquals(1, api.recoveryCalls)
        assertEquals(original, pending.current())
        api.response.complete(DeviceBootstrapResult("recovered-device", "PAIRING_PENDING"))
        job.join()
        c.confirmProfile()
        assertEquals("recovered-device", family.currentState()?.deviceId)
    }

    @Test
    fun `activity deep link waits for active recovery and only one link may wait`() = runTest {
        val api = SuspendedApi()
        val original = retainedAttempt(LINK.substringAfter("token="))
        val pending = InMemoryPendingEnrollmentAttemptStore().apply { save(original) }
        val c = coordinator(api, pendingAttemptStore = pending)
        val recovery = launch { c.recoverAttempt() }
        runCurrent()
        assertEquals(1, api.recoveryCalls)

        var submissionResult: InvitationSubmissionResult? = null
        val admission = c.reserveInvitationSubmission()
        assertNotNull(admission)
        assertTrue(admission!!.waitsForCurrentOperation)
        val deepLink = launch { submissionResult = c.submitReservedInvitationLink(LINK, admission.permit) }
        runCurrent()
        assertEquals(EnrollmentState.RecoveryPending(original.serverBaseUrl), c.state.value)
        assertNull(c.reserveInvitationSubmission())

        api.response.completeExceptionally(RecoveryError.NotFound)
        runCurrent()
        recovery.join()
        deepLink.join()

        assertEquals(EnrollmentState.BootstrapResultUnknown, c.state.value)
        assertEquals(InvitationSubmissionResult.PROCESSED, submissionResult)
        assertEquals(original, pending.current())
        assertEquals(1, api.recoveryCalls)
    }

    @Test
    fun `deep link admission is synchronous and refuses a second queued uri`() {
        val c = coordinator(NeverCalledBootstrapApiClient())
        val admission = c.reserveInvitationSubmission()
        assertNotNull(admission)
        assertNull(c.reserveInvitationSubmission())
        admission!!.permit.release()
        val next = c.reserveInvitationSubmission()
        assertNotNull(next)
        next!!.permit.release()
    }

    @Test
    fun `queued invitation asks user to reopen after current bootstrap reaches profile confirmation`() = runTest {
        val api = SuspendedApi()
        val pending = InMemoryPendingEnrollmentAttemptStore()
        val c = coordinator(api, TestConformanceDeviceKeyPairGenerator(), pendingAttemptStore = pending)
        c.submitInvitationLink(LINK)
        val bootstrap = launch { c.beginBootstrap() }
        runCurrent()
        assertEquals(1, api.bootstrapCalls)

        val admission = c.reserveInvitationSubmission()
        assertNotNull(admission)
        assertTrue(admission!!.waitsForCurrentOperation)
        var submissionResult: InvitationSubmissionResult? = null
        val deepLink = launch {
            submissionResult = c.submitReservedInvitationLink("pca://enroll?token=$OTHER_VALID_LINK_TOKEN", admission.permit)
        }
        runCurrent()

        api.response.complete(DeviceBootstrapResult("completed-device", "PAIRING_PENDING"))
        runCurrent()
        bootstrap.join()
        deepLink.join()

        assertTrue(c.state.value is EnrollmentState.ProfileConfirmation)
        assertEquals(InvitationSubmissionResult.REOPEN_AFTER_CONFIRMATION, submissionResult)
        assertNotNull(pending.current())
    }

    @Test
    fun `redelivery of the invitation already in profile confirmation does not tell user to reopen it`() = runTest {
        val pending = InMemoryPendingEnrollmentAttemptStore()
        val c = coordinator(
            FakeBootstrapApiClient { DeviceBootstrapResult("confirmed-device", "PAIRING_PENDING") },
            TestConformanceDeviceKeyPairGenerator(),
            pendingAttemptStore = pending,
        )
        c.submitInvitationLink(LINK)
        c.beginBootstrap()
        assertTrue(c.state.value is EnrollmentState.ProfileConfirmation)

        val admission = c.reserveInvitationSubmission()!!
        assertEquals(
            InvitationSubmissionResult.CURRENT_INVITATION_ALREADY_IN_USE,
            c.submitReservedInvitationLink(LINK, admission.permit),
        )
        c.submitInvitationLink(LINK)
        assertTrue(c.state.value is EnrollmentState.ProfileConfirmation)
    }

    @Test
    fun `legacy profile confirmation does not claim it can verify a rescanned invitation`() = runTest {
        val pending = InMemoryPendingEnrollmentAttemptStore().apply { save(retainedAttempt()) }
        val c = coordinator(
            FakeRecoveryApiClient { DeviceBootstrapResult("legacy-device", "PAIRING_PENDING") },
            pendingAttemptStore = pending,
        )
        c.recoverAttempt()
        assertTrue(c.state.value is EnrollmentState.ProfileConfirmation)

        val admission = c.reserveInvitationSubmission()!!
        assertEquals(
            InvitationSubmissionResult.CURRENT_INVITATION_UNVERIFIED,
            c.submitReservedInvitationLink(LINK, admission.permit),
        )
        assertTrue(c.state.value is EnrollmentState.ProfileConfirmation)
    }

    @Test
    fun `different invitation is rejected with feedback while original bootstrap outcome is unresolved`() = runTest {
        val pending = InMemoryPendingEnrollmentAttemptStore()
        val c = coordinator(
            ThrowingBootstrapApiClient(BootstrapError.InvitationUnavailable),
            TestConformanceDeviceKeyPairGenerator(),
            pendingAttemptStore = pending,
        )
        c.submitInvitationLink(LINK)
        c.beginBootstrap()
        val original = pending.current()
        assertEquals(EnrollmentState.BootstrapResultUnknown, c.state.value)

        val admission = c.reserveInvitationSubmission()!!
        assertEquals(
            InvitationSubmissionResult.REJECTED_UNRESOLVED,
            c.submitReservedInvitationLink("pca://enroll?token=$OTHER_VALID_LINK_TOKEN", admission.permit),
        )
        assertEquals(EnrollmentState.BootstrapResultUnknown, c.state.value)
        assertEquals(original, pending.current())
    }

    @Test
    fun `cancelling a queued invitation releases its synchronous admission permit`() = runTest {
        val api = SuspendedApi()
        val pending = InMemoryPendingEnrollmentAttemptStore().apply { save(retainedAttempt(VALID_LINK_TOKEN)) }
        val c = coordinator(api, pendingAttemptStore = pending)
        val recovery = launch { c.recoverAttempt() }
        runCurrent()
        val admission = c.reserveInvitationSubmission()!!
        val queued = launch { c.submitReservedInvitationLink(LINK, admission.permit) }
        runCurrent()

        queued.cancelAndJoin()
        val nextAdmission = c.reserveInvitationSubmission()
        assertNotNull(nextAdmission)
        nextAdmission!!.permit.release()
        recovery.cancelAndJoin()
    }

    @Test
    fun `cancelled bootstrap retains actionable durable recovery and releases operation admission`() = runTest {
        val api = SuspendedApi()
        val pending = InMemoryPendingEnrollmentAttemptStore()
        val c = coordinator(api, TestConformanceDeviceKeyPairGenerator(), pendingAttemptStore = pending)
        c.submitInvitationLink(LINK)
        val job = launch { c.beginBootstrap() }
        runCurrent()
        val original = pending.current()!!
        job.cancelAndJoin()
        assertEquals(original, pending.current())
        assertEquals(EnrollmentState.RecoveryPending(original.serverBaseUrl), c.state.value)
        api.response.complete(DeviceBootstrapResult("recovered-device", "PAIRING_PENDING"))
        c.recoverAttempt()
        assertTrue(c.state.value is EnrollmentState.ProfileConfirmation)
        assertEquals(1, api.recoveryCalls)
    }

    @Test
    fun `late bootstrap result cannot authorize replacement pending record`() = runTest {
        val api = SuspendedApi()
        val pending = InMemoryPendingEnrollmentAttemptStore()
        val family = PersistentFamilyStateStore(InMemoryPersistentStateStore())
        val c = coordinator(api, TestConformanceDeviceKeyPairGenerator(), family, pending)
        c.submitInvitationLink(LINK)
        val job = launch { c.beginBootstrap() }
        runCurrent()
        assertNotNull(c.keyFingerprints.value)
        val replacement = retainedAttempt()
        pending.save(replacement)
        api.response.complete(DeviceBootstrapResult("late-device", "PAIRING_PENDING"))
        job.join()
        assertNull(c.keyFingerprints.value)
        assertEquals(EnrollmentState.RecoveryPending(replacement.serverBaseUrl), c.state.value)
        assertEquals(replacement, pending.current())
        assertNull(family.currentState())
    }

    @Test
    fun `late definitive failure does not clear replacement recovery credentials`() = runTest {
        val api = SuspendedApi()
        val pending = InMemoryPendingEnrollmentAttemptStore()
        val c = coordinator(api, TestConformanceDeviceKeyPairGenerator(), pendingAttemptStore = pending)
        c.submitInvitationLink(LINK)
        val job = launch { c.beginBootstrap() }
        runCurrent()
        val replacement = retainedAttempt()
        pending.save(replacement)
        api.response.completeExceptionally(BootstrapError.InvitationUnavailable)
        job.join()
        assertEquals(replacement, pending.current())
        assertEquals(EnrollmentState.RecoveryPending(replacement.serverBaseUrl), c.state.value)
    }

    @Test
    fun `profile confirmation is bound to the exact attempt`() = runTest {
        val pending = InMemoryPendingEnrollmentAttemptStore()
        val family = PersistentFamilyStateStore(InMemoryPersistentStateStore())
        val c = coordinator(FakeBootstrapApiClient { DeviceBootstrapResult("old-device", "PAIRING_PENDING") },
            TestConformanceDeviceKeyPairGenerator(), family, pending)
        c.submitInvitationLink(LINK)
        c.beginBootstrap()
        assertNotNull(c.keyFingerprints.value)
        val replacement = retainedAttempt().copy(attemptId = "replacement")
        pending.save(replacement)
        c.confirmProfile()
        assertNull(c.keyFingerprints.value)
        assertEquals(replacement, pending.current())
        assertNull(family.currentState())
        assertEquals(EnrollmentState.RecoveryPending(replacement.serverBaseUrl), c.state.value)
    }

    @Test
    fun `cancelled recovery preserves credentials and admits explicit retry`() = runTest {
        val api = SuspendedApi()
        val original = retainedAttempt()
        val pending = InMemoryPendingEnrollmentAttemptStore().apply { save(original) }
        val c = coordinator(api, pendingAttemptStore = pending)
        val job = launch { c.recoverAttempt() }
        runCurrent()
        job.cancelAndJoin()
        assertEquals(original, pending.current())
        assertEquals(EnrollmentState.RecoveryPending(original.serverBaseUrl), c.state.value)
        api.response.complete(DeviceBootstrapResult("recovered", "PAIRING_PENDING"))
        c.recoverAttempt()
        assertEquals(2, api.recoveryCalls)
        assertTrue(c.state.value is EnrollmentState.ProfileConfirmation)
    }

    @Test
    fun `late recovery success cannot confirm another pending attempt`() = runTest {
        val api = SuspendedApi()
        val original = retainedAttempt()
        val pending = InMemoryPendingEnrollmentAttemptStore().apply { save(original) }
        val family = PersistentFamilyStateStore(InMemoryPersistentStateStore())
        val c = coordinator(api, familyStateStore = family, pendingAttemptStore = pending)
        val job = launch { c.recoverAttempt() }
        runCurrent()
        val replacement = original.copy(attemptId = "replacement")
        pending.save(replacement)
        api.response.complete(DeviceBootstrapResult("late", "PAIRING_PENDING"))
        job.join()
        assertNull(family.currentState())
        assertEquals(replacement, pending.current())
        assertEquals(EnrollmentState.RecoveryPending(replacement.serverBaseUrl), c.state.value)
    }

}
