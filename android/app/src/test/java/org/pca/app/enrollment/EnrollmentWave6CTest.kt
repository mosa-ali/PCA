package org.pca.app.enrollment

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.pca.app.foundation.InMemoryPersistentStateStore
import org.pca.app.firstdevice.FirstDeviceCeremonySeed
import org.pca.app.firstdevice.FirstDeviceRootRecord
import org.pca.app.firstdevice.FirstDeviceRootState
import org.pca.app.firstdevice.FirstDeviceSubmissionPayload
import org.pca.app.firstdevice.InMemoryFirstDeviceRootStore
import org.pca.app.security.DeviceKeyPairDeletion
import org.pca.app.security.DeviceKeyPairGenerator
import org.pca.app.security.GeneratedKeyPair
import org.pca.app.security.SecureKeyUnavailableException
import org.pca.app.security.TestConformanceDeviceKeyPairGenerator
import org.pca.app.storage.InMemoryPendingEnrollmentAttemptStore
import org.pca.app.storage.PendingEnrollmentAttemptStore
import org.pca.app.storage.PersistentFamilyStateStore
import org.pca.app.storage.PersistentPendingEnrollmentAttemptStore

/**
 * Wave 6C enrollment-integration tests: attempt-id-before-keygen ordering,
 * orphan cleanup, delete-on-abandon, the typed SecureKeyUnavailable mapping,
 * and the ceremony-seed capture at enrollment success. Complements the
 * existing EnrollmentCoordinatorTest (which continues to cover the
 * pre-Wave-6C lifecycle cases).
 */
class EnrollmentWave6CTest {

    private val link = "pca://enroll?token=wave6c-token"

    private class RecordingGenerator(
        private val deleteLog: MutableList<String> = mutableListOf(),
        private val events: MutableList<String> = mutableListOf(),
    ) : DeviceKeyPairGenerator, DeviceKeyPairDeletion {
        private val delegate = TestConformanceDeviceKeyPairGenerator()
        val attemptIds = mutableListOf<String>()
        var lastSigningAlias: String? = null
        var lastEncryptionAlias: String? = null
        var throwSecureUnavailable = false

        override fun generateSigningKeyPair(attemptId: String): GeneratedKeyPair {
            if (throwSecureUnavailable) throw SecureKeyUnavailableException("test: no hardware key")
            attemptIds += attemptId
            events += "generate-signing"
            val pair = delegate.generateSigningKeyPair(attemptId)
            lastSigningAlias = pair.privateKeyAlias
            return pair
        }

        override fun generateEncryptionKeyPair(attemptId: String): GeneratedKeyPair {
            if (throwSecureUnavailable) throw SecureKeyUnavailableException("test: no hardware key")
            attemptIds += attemptId
            events += "generate-encryption"
            val pair = delegate.generateEncryptionKeyPair(attemptId)
            lastEncryptionAlias = pair.privateKeyAlias
            return pair
        }

        override fun deleteKeyPair(alias: String) {
            deleteLog += alias
        }

        override fun deleteOrphanedAttemptKeys(keepAttemptIds: Set<String>) {
            events += "cleanup:${keepAttemptIds.joinToString(",")}"
        }
    }

    private class FixedApi(
        private val result: DeviceBootstrapResult?,
        private val error: Exception? = null,
    ) : DeviceBootstrapApiClient {
        var calls = 0
        override suspend fun bootstrap(
            rawInvitationToken: String,
            platform: String,
            signingPublicKeyBase64: String,
            encryptionPublicKeyBase64: String,
            bootstrapAttemptId: String,
            attemptRecoveryToken: String,
        ): DeviceBootstrapResult {
            calls++
            error?.let { throw it }
            return result!!
        }

        override suspend fun recoverAttempt(bootstrapAttemptId: String, attemptRecoveryToken: String): DeviceBootstrapResult = result!!
    }

    private fun parser() = UriEnrollmentLinkParser(EnrollmentDeepLinkConfig.EXPECTED_SCHEME, EnrollmentDeepLinkConfig.EXPECTED_HOST)

    @Test
    fun `attemptId is minted before key generation, reused for both keys, and is the durable pending attempt id`() = runTest {
        val events = mutableListOf<String>()
        val generator = RecordingGenerator(events = events)
        val pendingAttemptStore = InMemoryPendingEnrollmentAttemptStore()
        val coordinator = EnrollmentCoordinator(
            parser(),
            FixedApi(DeviceBootstrapResult("device-1", "PAIRING_PENDING", signingKeyId = "dsk-1", encryptionKeyId = "dek-1")),
            generator,
            PersistentFamilyStateStore(InMemoryPersistentStateStore()),
            pendingAttemptStore,
        )
        coordinator.submitInvitationLink(link)
        coordinator.beginBootstrap()

        val pending = pendingAttemptStore.current()!!
        assertEquals(listOf(pending.attemptId, pending.attemptId), generator.attemptIds)
        assertEquals("cleanup:${pending.attemptId}", events.first())
        assertEquals(listOf("cleanup:${pending.attemptId}", "generate-signing", "generate-encryption"), events)
    }

    @Test
    fun `SecureKeyUnavailable is a typed fail-closed state - no persistence, no network, no partial trace`() = runTest {
        val generator = RecordingGenerator()
        generator.throwSecureUnavailable = true
        val pendingAttemptStore = InMemoryPendingEnrollmentAttemptStore()
        val familyStateStore = PersistentFamilyStateStore(InMemoryPersistentStateStore())
        val api = FixedApi(DeviceBootstrapResult("device-1", "PAIRING_PENDING", signingKeyId = "dsk-1", encryptionKeyId = "dek-1"))
        val coordinator = EnrollmentCoordinator(parser(), api, generator, familyStateStore, pendingAttemptStore)
        coordinator.submitInvitationLink(link)
        coordinator.beginBootstrap()

        assertEquals(EnrollmentState.SecureKeyUnavailable, coordinator.state.value)
        assertNull(pendingAttemptStore.current())
        assertNull(familyStateStore.currentState())
        assertEquals(0, api.calls)
    }

    @Test
    fun `a definitively-abandoned attempt deletes BOTH key aliases before clearing the record (delete-before-clear)`() = runTest {
        val deleteLog = mutableListOf<String>()
        val generator = RecordingGenerator(deleteLog)
        val pendingAttemptStore = InMemoryPendingEnrollmentAttemptStore()
        val coordinator = EnrollmentCoordinator(
            parser(),
            FixedApi(null, BootstrapError.InvitationUnavailable),
            generator,
            PersistentFamilyStateStore(InMemoryPersistentStateStore()),
            pendingAttemptStore,
        )
        coordinator.submitInvitationLink(link)
        coordinator.beginBootstrap()

        assertEquals(EnrollmentState.FailedInvitationInvalid, coordinator.state.value)
        assertNull(pendingAttemptStore.current())
        assertEquals(listOf(generator.lastSigningAlias, generator.lastEncryptionAlias), deleteLog)
    }

    @Test
    fun `confirmProfile captures the ceremony seed with server key ids, aliases and the attempt credential`() = runTest {
        val rootStore = InMemoryFirstDeviceRootStore()
        val generator = RecordingGenerator()
        val pendingAttemptStore = InMemoryPendingEnrollmentAttemptStore()
        val coordinator = EnrollmentCoordinator(
            parser(),
            FixedApi(DeviceBootstrapResult("device-1", "PAIRING_PENDING", signingKeyId = "dsk-1", encryptionKeyId = "dek-1")),
            generator,
            PersistentFamilyStateStore(InMemoryPersistentStateStore()),
            pendingAttemptStore,
            firstDeviceRootStore = rootStore,
        )
        coordinator.submitInvitationLink(link)
        coordinator.beginBootstrap()
        val pendingBeforeConfirm = pendingAttemptStore.current()!!
        coordinator.confirmProfile()

        assertEquals(EnrollmentState.PairingPending("device-1"), coordinator.state.value)
        val record = rootStore.current()!!
        assertEquals(FirstDeviceRootState.NOT_STARTED, record.state)
        assertEquals(pendingBeforeConfirm.attemptId, record.seed.attemptId)
        assertEquals(pendingBeforeConfirm.attemptRecoveryToken, record.seed.attemptRecoveryToken)
        assertEquals("dsk-1", record.seed.signingKeyId)
        assertEquals("dek-1", record.seed.encryptionKeyId)
        assertEquals("device-1", record.seed.deviceId)
        assertEquals(generator.lastSigningAlias, record.seed.dskAlias)
        assertEquals(generator.lastEncryptionAlias, record.seed.dekAlias)
        assertNull(pendingAttemptStore.current())
    }

    @Test
    fun `seed capture never overwrites a ROOT_COMMITTED record`() = runTest {
        val rootStore = InMemoryFirstDeviceRootStore()
        rootStore.save(
            FirstDeviceRootRecord(
                seed = org.pca.app.firstdevice.FirstDeviceCeremonySeed(
                    attemptId = "committed-attempt",
                    attemptRecoveryToken = "",
                    serverBaseUrl = "https://example.test",
                    deviceId = "device-committed",
                    signingKeyId = "dsk-committed",
                    encryptionKeyId = "dek-committed",
                    dskPublicKeyBase64 = "a",
                    dekPublicKeyBase64 = "b",
                    dskAlias = "pca.dsk.committed",
                    dekAlias = "pca.dek.committed",
                ),
                state = FirstDeviceRootState.ROOT_COMMITTED,
            ),
        )
        val coordinator = EnrollmentCoordinator(
            parser(),
            FixedApi(DeviceBootstrapResult("device-2", "PAIRING_PENDING", signingKeyId = "dsk-2", encryptionKeyId = "dek-2")),
            RecordingGenerator(),
            PersistentFamilyStateStore(InMemoryPersistentStateStore()),
            InMemoryPendingEnrollmentAttemptStore(),
            firstDeviceRootStore = rootStore,
        )
        coordinator.submitInvitationLink(link)
        coordinator.beginBootstrap()
        coordinator.confirmProfile()

        val record = rootStore.current()!!
        assertEquals(FirstDeviceRootState.ROOT_COMMITTED, record.state)
        assertEquals("committed-attempt", record.seed.attemptId)
        assertTrue(record.seed.deviceId == "device-committed")
    }

    @Test
    fun `orphan cleanup keeps the trust root's attempt aliases (Stage-B fix, Agents 1-5-7)`() = runTest {
        val events = mutableListOf<String>()
        val generator = RecordingGenerator(events = events)
        val pendingAttemptStore = InMemoryPendingEnrollmentAttemptStore()
        val rootStore = InMemoryFirstDeviceRootStore()
        rootStore.save(
            FirstDeviceRootRecord(
                seed = FirstDeviceCeremonySeed(
                    attemptId = "committed-attempt",
                    attemptRecoveryToken = "tok",
                    serverBaseUrl = "https://example.test",
                    deviceId = "device-committed",
                    signingKeyId = "dsk-committed",
                    encryptionKeyId = "dek-committed",
                    dskPublicKeyBase64 = "a",
                    dekPublicKeyBase64 = "b",
                    dskAlias = "pca.dsk.committed-attempt",
                    dekAlias = "pca.dek.committed-attempt",
                ),
                state = FirstDeviceRootState.ROOT_COMMITTED,
            ),
        )
        val coordinator = EnrollmentCoordinator(
            parser(),
            FixedApi(DeviceBootstrapResult("device-2", "PAIRING_PENDING", signingKeyId = "dsk-2", encryptionKeyId = "dek-2")),
            generator,
            PersistentFamilyStateStore(InMemoryPersistentStateStore()),
            pendingAttemptStore,
            firstDeviceRootStore = rootStore,
        )
        coordinator.submitInvitationLink(link)
        coordinator.beginBootstrap()
        val pending = pendingAttemptStore.current()!!
        // The keep set MUST contain both the new attempt and the committed
        // root's attempt -- sweeping the root's aliases would destroy the
        // device's only family-root signing key.
        assertEquals("cleanup:${pending.attemptId},committed-attempt", events.first { it.startsWith("cleanup:") })
    }

    @Test
    fun `seed capture never replaces a NON-terminal in-flight ceremony record (Stage-B fix, Agent 5 MINOR-2)`() = runTest {
        val rootStore = InMemoryFirstDeviceRootStore()
        rootStore.save(
            FirstDeviceRootRecord(
                seed = FirstDeviceCeremonySeed(
                    attemptId = "in-flight-attempt",
                    attemptRecoveryToken = "tok",
                    serverBaseUrl = "https://example.test",
                    deviceId = "device-inflight",
                    signingKeyId = "dsk-inflight",
                    encryptionKeyId = "dek-inflight",
                    dskPublicKeyBase64 = "a",
                    dekPublicKeyBase64 = "b",
                    dskAlias = "pca.dsk.in-flight-attempt",
                    dekAlias = "pca.dek.in-flight-attempt",
                ),
                state = FirstDeviceRootState.SUBMITTING,
                ceremonyId = "ceremony-original",
                submission = FirstDeviceSubmissionPayload("p", "ps", "e", "es", "ev"),
            ),
        )
        val coordinator = EnrollmentCoordinator(
            parser(),
            FixedApi(DeviceBootstrapResult("device-3", "PAIRING_PENDING", signingKeyId = "dsk-3", encryptionKeyId = "dek-3")),
            RecordingGenerator(),
            PersistentFamilyStateStore(InMemoryPersistentStateStore()),
            InMemoryPendingEnrollmentAttemptStore(),
            firstDeviceRootStore = rootStore,
        )
        coordinator.submitInvitationLink(link)
        coordinator.beginBootstrap()
        coordinator.confirmProfile()

        val record = rootStore.current()!!
        assertEquals(FirstDeviceRootState.SUBMITTING, record.state)
        assertEquals("ceremony-original", record.ceremonyId)
        assertEquals("p", record.submission!!.proofBytes)
        assertEquals("in-flight-attempt", record.seed.attemptId)
    }
}
