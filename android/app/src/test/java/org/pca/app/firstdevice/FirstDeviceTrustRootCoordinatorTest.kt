package org.pca.app.firstdevice

import java.util.Date
import kotlinx.coroutines.async
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import org.json.JSONObject
import org.pca.app.security.DskSignatureEngine
import org.pca.app.security.DeviceKeyAttestationEvidenceSource
import org.pca.app.security.KeyMaterialMissingException

/**
 * Wave 6C: behavioral suite for the first-device trust-root ceremony
 * coordinator. Every test here is also the kill surface for the Wave-6C
 * mutation campaign: C-SEC-008 (no optimistic commit before server
 * acceptance), C-SEC-010 (no key/root minting after a committed root or on
 * key loss), C-SEC-009-adjacent (status-first resolution), plus the
 * byte-stable-retry and never-re-challenge invariants.
 */
class FirstDeviceTrustRootCoordinatorTest {

    // ---------- fakes ----------

    private class RecordingStore(val inner: FirstDeviceRootStore = InMemoryFirstDeviceRootStore()) : FirstDeviceRootStore {
        var saves = 0
        var flushes = 0
        override fun current(): FirstDeviceRootRecord? = inner.current()
        override fun readState(): FirstDeviceRootReadResult = inner.readState()
        override fun withConfirmedSafeAttemptKeyCleanup(attemptId: String, cleanup: () -> Unit): Boolean =
            inner.withConfirmedSafeAttemptKeyCleanup(attemptId, cleanup)
        override fun save(record: FirstDeviceRootRecord) { saves++; inner.save(record) }
        override fun clear() = inner.clear()
        override fun writeIfCurrent(expected: FirstDeviceRootRecord?, record: FirstDeviceRootRecord): Boolean {
            val written = inner.writeIfCurrent(expected, record)
            if (written) { saves++; flushes++ }
            return written
        }
        override fun captureSeed(
            candidate: FirstDeviceRootRecord,
            replaceableTerminalStates: Set<FirstDeviceRootState>,
        ): Boolean = inner.captureSeed(candidate, replaceableTerminalStates)
        override fun confirmDurable(record: FirstDeviceRootRecord): Boolean = inner.confirmDurable(record)
        override fun flush() { flushes++ }
    }

    private class FakeApi : FirstDeviceBootstrapApiClient {
        val challengeCalls = mutableListOf<List<String>>()
        val submitCalls = mutableListOf<Map<String, String>>()
        val statusCalls = mutableListOf<String>()
        var challengeResult: () -> FirstDeviceChallenge = {
            FirstDeviceChallenge(
                ceremonyId = "ceremony-1",
                challengeId = "challenge-1",
                nonce = "n".repeat(43),
                expiresAt = "2026-10-02T01:00:00.000Z",
                familyId = "family-1",
                deviceId = "device-1",
            )
        }
        var challengeError: Exception? = null
        var onBeforeChallengeReturn: (() -> Unit)? = null
        var submitOutcome: () -> FirstDeviceSubmitOutcome = { FirstDeviceSubmitOutcome("ACCEPTED") }
        var onBeforeSubmitReturn: (() -> Unit)? = null
        var statusOutcome: () -> FirstDeviceStatusOutcome = { FirstDeviceStatusOutcome("PENDING", null) }
        var statusError: Exception? = null

        override suspend fun challenge(attemptId: String, attemptRecoveryToken: String, dskKeyId: String, dskPublicKeyBase64: String): FirstDeviceChallenge {
            challengeCalls += listOf(attemptId, attemptRecoveryToken, dskKeyId, dskPublicKeyBase64)
            challengeError?.let { throw it }
            onBeforeChallengeReturn?.invoke()
            return challengeResult()
        }

        override suspend fun submit(
            attemptId: String,
            attemptRecoveryToken: String,
            ceremonyId: String,
            proofBytes: String,
            proofSignature: String,
            epoch1Bytes: String,
            epoch1Signature: String,
            attestationEvidence: String,
        ): FirstDeviceSubmitOutcome {
            submitCalls += mapOf(
                "attemptId" to attemptId,
                "ceremonyId" to ceremonyId,
                "proofBytes" to proofBytes,
                "proofSignature" to proofSignature,
                "epoch1Bytes" to epoch1Bytes,
                "epoch1Signature" to epoch1Signature,
                "attestationEvidence" to attestationEvidence,
            )
            onBeforeSubmitReturn?.invoke()
            return submitOutcome()
        }

        override suspend fun status(attemptId: String, attemptRecoveryToken: String, ceremonyId: String): FirstDeviceStatusOutcome {
            statusCalls += ceremonyId
            statusError?.let { throw it }
            return statusOutcome()
        }
    }

    private class FakeEngine : DskSignatureEngine {
        var signCalls = 0
        var throwMissing = false
        override fun signCanonicalDer(alias: String, message: ByteArray): ByteArray {
            signCalls++
            if (throwMissing) throw KeyMaterialMissingException("test: no key")
            return ByteArray(64) { (alias.length + message.size + it).toByte() }
        }
    }

    private class FakeEvidenceSource : DeviceKeyAttestationEvidenceSource {
        var chainCalls = 0
        var throwMissing = false
        var emptyChain = false
        override fun certificateChainDer(alias: String): List<ByteArray> {
            chainCalls++
            if (throwMissing) throw KeyMaterialMissingException("test: no chain")
            if (emptyChain) return emptyList()
            return listOf(byteArrayOf(1, 2, 3), byteArrayOf(4, 5))
        }
    }

    private class Rig {
        val seed = FirstDeviceCeremonySeed(
            attemptId = "a".repeat(32),
            attemptRecoveryToken = "r".repeat(43),
            serverBaseUrl = "https://example.test",
            deviceId = "device-1",
            signingKeyId = "55555555-5555-4555-8555-555555555555",
            encryptionKeyId = "66666666-6666-4666-8666-666666666666",
            dskPublicKeyBase64 = "dsk-pub",
            dekPublicKeyBase64 = "dek-pub",
            dskAlias = "pca.dsk." + "a".repeat(32),
            dekAlias = "pca.dek." + "a".repeat(32),
        )
        val store = RecordingStore()
        val api = FakeApi()
        val engine = FakeEngine()
        val evidence = FakeEvidenceSource()
        val coordinator = FirstDeviceTrustRootCoordinator(
            rootStore = store,
            apiClient = api,
            signatureEngine = engine,
            evidenceSource = evidence,
            now = { Date(1790899200123L) }, // fixed: 2026-10-02T00:00:00.123Z
        )

        fun withApproved(): Rig {
            store.save(
                FirstDeviceRootRecord(
                    seed = seed,
                    state = FirstDeviceRootState.APPROVED,
                    ceremonyId = "ceremony-1",
                    challengeId = "challenge-1",
                    nonce = "n".repeat(43),
                    expiresAt = "2026-10-02T01:00:00.000Z",
                    familyId = "family-1",
                ),
            )
            return this
        }

        fun withState(state: FirstDeviceRootState, submission: FirstDeviceSubmissionPayload? = null): Rig {
            store.save(
                FirstDeviceRootRecord(
                    seed = seed,
                    state = state,
                    ceremonyId = "ceremony-1",
                    challengeId = "challenge-1",
                    nonce = "n".repeat(43),
                    expiresAt = "2026-10-02T01:00:00.000Z",
                    familyId = "family-1",
                    submission = submission,
                ),
            )
            return this
        }
    }

    // ---------- beginCeremony ----------

    @Test
    fun `beginCeremony persists the challenge and flushes before returning`() = runTest {
        val rig = Rig().withState(FirstDeviceRootState.NOT_STARTED)
        rig.coordinator.beginCeremony()
        val record = rig.store.current()!!
        assertEquals(FirstDeviceRootState.AWAITING_APPROVAL, record.state)
        assertEquals("ceremony-1", record.ceremonyId)
        assertEquals("2026-10-02T01:00:00.000Z", record.expiresAt)
        assertEquals(1, rig.api.challengeCalls.size)
        assertTrue(rig.store.flushes >= 1)
    }

    @Test
    fun `beginCeremony after SUBMITTING never re-challenges (post-commit challenge would mint a NEW ceremony id)`() = runTest {
        val rig = Rig().withState(
            FirstDeviceRootState.SUBMITTING,
            submission = FirstDeviceSubmissionPayload("p", "ps", "e", "es", "ev"),
        )
        rig.coordinator.beginCeremony()
        assertEquals(0, rig.api.challengeCalls.size)
        assertEquals(0, rig.api.submitCalls.size)
        assertEquals(0, rig.api.statusCalls.size)
    }

    @Test
    fun `beginCeremony after ROOT_COMMITTED performs zero network calls`() = runTest {
        val rig = Rig().withState(FirstDeviceRootState.ROOT_COMMITTED)
        rig.coordinator.beginCeremony()
        rig.coordinator.submit()
        rig.coordinator.resubmitExact()
        assertEquals(0, rig.api.challengeCalls.size + rig.api.submitCalls.size + rig.api.statusCalls.size)
        assertEquals(0, rig.engine.signCalls)
        assertEquals(FirstDeviceRootState.ROOT_COMMITTED, rig.store.current()!!.state)
    }

    @Test
    fun `beginCeremony while AWAITING_APPROVAL resolves via status instead of minting a parallel ceremony`() = runTest {
        val rig = Rig().withState(FirstDeviceRootState.AWAITING_APPROVAL)
        rig.api.statusOutcome = { FirstDeviceStatusOutcome("APPROVED", null) }
        rig.coordinator.beginCeremony()
        assertEquals(0, rig.api.challengeCalls.size)
        assertEquals(1, rig.api.statusCalls.size)
        assertEquals(FirstDeviceRootState.APPROVED, rig.store.current()!!.state)
    }

    // ---------- status mapping ----------

    @Test
    fun `status mapping covers PENDING APPROVED COMMITTED ACCEPTED EXPIRED and unknown values`() = runTest {
        suspend fun resolve(status: String, outcome: String?): FirstDeviceRootState {
            val rig = Rig().withState(FirstDeviceRootState.AWAITING_APPROVAL)
            rig.api.statusOutcome = { FirstDeviceStatusOutcome(status, outcome) }
            rig.coordinator.refreshStatus()
            return rig.store.current()!!.state
        }
        assertEquals(FirstDeviceRootState.AWAITING_APPROVAL, resolve("PENDING", null))
        assertEquals(FirstDeviceRootState.APPROVED, resolve("APPROVED", null))
        assertEquals(FirstDeviceRootState.EXPIRED, resolve("EXPIRED", null))
        assertEquals(FirstDeviceRootState.UNKNOWN, resolve("SOMETHING_NEW", null))
        assertEquals(FirstDeviceRootState.UNKNOWN, resolve("COMMITTED", null))
    }

    @Test
    fun `status 404 resolves to UNKNOWN -- never a success, never a fabricated commit`() = runTest {
        val rig = Rig().withState(FirstDeviceRootState.AWAITING_APPROVAL)
        rig.api.statusError = FirstDeviceBootstrapError.Unavailable
        rig.coordinator.refreshStatus()
        assertEquals(FirstDeviceRootState.UNKNOWN, rig.store.current()!!.state)
    }

    @Test
    fun `authoritative EXPIRED trims the persisted submission so the documented restart path works (Agent 6 MINOR-1)`() = runTest {
        val rig = Rig().withState(
            FirstDeviceRootState.SUBMITTING,
            submission = FirstDeviceSubmissionPayload("p", "ps", "e", "es", "ev"),
        )
        rig.api.statusOutcome = { FirstDeviceStatusOutcome("EXPIRED", null) }
        rig.coordinator.refreshStatus()
        assertEquals(FirstDeviceRootState.EXPIRED, rig.store.current()!!.state)
        assertNull(rig.store.current()!!.submission)
        // The documented restart is now actually reachable: no submission
        // remains, so beginCeremony is a legal explicit start again.
        rig.coordinator.beginCeremony()
        assertEquals(1, rig.api.challengeCalls.size)
    }

    @Test
    fun `status COMMITTED plus ACCEPTED is the second (and only other) legal path to ROOT_COMMITTED`() = runTest {
        val rig = Rig().withState(FirstDeviceRootState.SUBMITTING, submission = FirstDeviceSubmissionPayload("p", "ps", "e", "es", "ev"))
        rig.api.statusOutcome = { FirstDeviceStatusOutcome("COMMITTED", "ACCEPTED") }
        rig.coordinator.refreshStatus()
        val record = rig.store.current()!!
        assertEquals(FirstDeviceRootState.ROOT_COMMITTED, record.state)
        assertNotNull(record.committedAtMillis)
        assertNull(record.submission)
        assertEquals("e", record.acceptedEpoch1?.canonicalBytes)
        assertEquals("es", record.acceptedEpoch1?.signatureBase64Url)
    }

    // ---------- submit ----------

    @Test
    fun `submit builds the payload once, persists it BEFORE the network call, and commits only on ACCEPTED`() = runTest {
        val rig = Rig().withApproved()
        var storeStateDuringSubmit: FirstDeviceRootState? = null
        rig.api.onBeforeSubmitReturn = { storeStateDuringSubmit = rig.store.current()?.state }
        rig.coordinator.submit()
        assertEquals(FirstDeviceRootState.SUBMITTING, storeStateDuringSubmit)
        assertEquals(1, rig.api.submitCalls.size)
        val record = rig.store.current()!!
        assertEquals(FirstDeviceRootState.ROOT_COMMITTED, record.state)
        // Trimmed: submission bytes + token cleared on commit.
        assertNull(record.submission)
        assertEquals("", record.seed.attemptRecoveryToken)
        assertEquals(rig.api.submitCalls.single()["epoch1Bytes"], record.acceptedEpoch1?.canonicalBytes)
        assertEquals(rig.api.submitCalls.single()["epoch1Signature"], record.acceptedEpoch1?.signatureBase64Url)
    }

    @Test
    fun `payload bytes bind the challenge verbatim, the same DSK for both statements, and the evidence digest in both places`() = runTest {
        val rig = Rig().withApproved()
        rig.coordinator.submit()
        val sent = rig.api.submitCalls.single()
        val proof = sent["proofBytes"]!!
        val epoch = sent["epoch1Bytes"]!!
        assertTrue(proof.contains("2026-10-02T01:00:00.000Z"))
        assertTrue(proof.contains("challenge-1"))
        assertTrue(proof.contains("n".repeat(43)))
        assertTrue(proof.contains("55555555-5555-4555-8555-555555555555"))
        assertTrue(epoch.contains("5:OWNER") && epoch.contains("6:ACTIVE"))
        val evidence = sent["attestationEvidence"]!!
        val parsed = JSONObject(evidence)
        assertEquals(1, parsed.getInt("v"))
        assertEquals("ANDROID", parsed.getString("platform"))
        assertEquals("a".repeat(32), parsed.getString("attemptId"))
        // Evidence digest appears inside the proof; epoch hash too.
        assertTrue(proof.contains(FirstDeviceCanonical.sha256Hex(evidence)))
        assertTrue(proof.contains(FirstDeviceCanonical.sha256Hex(epoch)))
        assertEquals(2, rig.engine.signCalls) // proof + epoch-1, same engine (same DSK alias)
    }

    @Test
    fun `rejected submit resolves via status first (APPROVED means genuine rejection, COMMITTED means the root WAS accepted)`() = runTest {
        val rejected = Rig().withApproved()
        rejected.api.submitOutcome = { throw FirstDeviceBootstrapError.Rejected }
        rejected.api.statusOutcome = { FirstDeviceStatusOutcome("APPROVED", null) }
        rejected.coordinator.submit()
        assertEquals(FirstDeviceRootState.REJECTED, rejected.store.current()!!.state)

        val actuallyCommitted = Rig().withApproved()
        actuallyCommitted.api.submitOutcome = { throw FirstDeviceBootstrapError.Rejected }
        actuallyCommitted.api.statusOutcome = { FirstDeviceStatusOutcome("COMMITTED", "ACCEPTED") }
        actuallyCommitted.coordinator.submit()
        assertEquals(FirstDeviceRootState.ROOT_COMMITTED, actuallyCommitted.store.current()!!.state)
    }

    @Test
    fun `beginCeremony from UNKNOWN with a persisted submission resolves via status and never mints a parallel ceremony (Stage-B fix, Agents 5 and 7)`() = runTest {
        val rig = Rig().withState(
            FirstDeviceRootState.UNKNOWN,
            submission = FirstDeviceSubmissionPayload("p", "ps", "e", "es", "ev"),
        )
        rig.api.statusOutcome = { FirstDeviceStatusOutcome("COMMITTED", "ACCEPTED") }
        rig.coordinator.beginCeremony()
        assertEquals(0, rig.api.challengeCalls.size) // never re-challenged
        assertEquals(1, rig.api.statusCalls.size)
        assertEquals("ceremony-1", rig.store.current()!!.ceremonyId) // original ceremony id preserved
        assertEquals(FirstDeviceRootState.ROOT_COMMITTED, rig.store.current()!!.state)
    }

    @Test
    fun `beginCeremony from UNKNOWN WITHOUT a submission is still a legal explicit start (challenge allowed)`() = runTest {
        val rig = Rig().withState(FirstDeviceRootState.UNKNOWN)
        rig.coordinator.beginCeremony()
        assertEquals(1, rig.api.challengeCalls.size)
        assertEquals(FirstDeviceRootState.AWAITING_APPROVAL, rig.store.current()!!.state)
    }

    @Test
    fun `ambiguous submit outcome keeps the payload for byte-identical resubmission and never re-signs`() = runTest {
        val rig = Rig().withApproved()
        rig.api.submitOutcome = { throw FirstDeviceBootstrapError.AmbiguousOutcome }
        rig.coordinator.submit()
        assertEquals(FirstDeviceRootState.UNKNOWN, rig.store.current()!!.state)
        val firstPayload = rig.store.current()!!.submission!!
        assertEquals(2, rig.engine.signCalls)
        rig.api.submitOutcome = { FirstDeviceSubmitOutcome("ACCEPTED") }
        rig.coordinator.resubmitExact()
        assertEquals(2, rig.api.submitCalls.size)
        assertEquals(rig.api.submitCalls[0]["proofBytes"], rig.api.submitCalls[1]["proofBytes"])
        assertEquals(rig.api.submitCalls[0]["proofSignature"], rig.api.submitCalls[1]["proofSignature"])
        assertEquals(rig.api.submitCalls[0]["epoch1Signature"], rig.api.submitCalls[1]["epoch1Signature"])
        assertEquals(rig.api.submitCalls[0]["attestationEvidence"], rig.api.submitCalls[1]["attestationEvidence"])
        assertEquals(2, rig.engine.signCalls) // resubmission performed ZERO signing
        assertEquals(firstPayload.proofBytes, rig.api.submitCalls[1]["proofBytes"])
        assertEquals(FirstDeviceRootState.ROOT_COMMITTED, rig.store.current()!!.state)
    }

    @Test
    fun `submit 404 resolves through status (pre-approval) and never commits locally`() = runTest {
        val rig = Rig().withApproved()
        rig.api.submitOutcome = { throw FirstDeviceBootstrapError.Unavailable }
        rig.api.statusOutcome = { FirstDeviceStatusOutcome("PENDING", null) }
        rig.coordinator.submit()
        assertEquals(FirstDeviceRootState.AWAITING_APPROVAL, rig.store.current()!!.state)
    }

    @Test
    fun `key material loss during payload build fails closed to UNKNOWN with zero network submits and zero regeneration`() = runTest {
        val rig = Rig().withApproved()
        rig.engine.throwMissing = true
        rig.coordinator.submit()
        assertEquals(FirstDeviceRootState.UNKNOWN, rig.store.current()!!.state)
        assertEquals(0, rig.api.submitCalls.size)
        assertNull(rig.store.current()!!.submission)
    }

    @Test
    fun `locally-invalid evidence input (empty chain) fails closed to UNKNOWN with zero network sends (Agent 2 MINOR-1)`() = runTest {
        val rig = Rig().withApproved()
        rig.evidence.emptyChain = true
        rig.coordinator.submit()
        assertEquals(FirstDeviceRootState.UNKNOWN, rig.store.current()!!.state)
        assertEquals(0, rig.api.submitCalls.size)
        assertEquals(0, rig.engine.signCalls)
        assertNull(rig.store.current()!!.submission)
    }

    @Test
    fun `C-SEC-008 kill surface - no outcome other than ACCEPTED or COMMITTED+ACCEPTED ever yields ROOT_COMMITTED`() = runTest {
        val outcomes = listOf(
            { FirstDeviceSubmitOutcome("ACCEPTED") },
            { throw FirstDeviceBootstrapError.Rejected },
            { throw FirstDeviceBootstrapError.Unavailable },
            { throw FirstDeviceBootstrapError.AmbiguousOutcome },
            { throw FirstDeviceBootstrapError.UnexpectedServerError },
            { throw FirstDeviceBootstrapError.InvalidRequest },
        )
        for (outcome in outcomes) {
            val rig = Rig().withApproved()
            rig.api.submitOutcome = outcome
            rig.api.statusOutcome = { FirstDeviceStatusOutcome("APPROVED", null) }
            rig.coordinator.submit()
            val state = rig.store.current()!!.state
            val isAcceptedOutcome = outcome === outcomes[0]
            if (!isAcceptedOutcome) {
                assertTrue("state $state must not be ROOT_COMMITTED", state != FirstDeviceRootState.ROOT_COMMITTED)
            }
        }
    }

    @Test
    fun `single-flight - concurrent submit attempts produce exactly one network submission`() = runTest {
        val rig = Rig().withApproved()
        val first = async { rig.coordinator.submit() }
        val second = async { rig.coordinator.submit() }
        first.await(); second.await()
        assertEquals(1, rig.api.submitCalls.size)
    }

    @Test
    fun `a stale challenge response cannot overwrite a newer seed captured during the network wait`() = runTest {
        val rig = Rig().withState(FirstDeviceRootState.EXPIRED)
        val expired = rig.store.current()!!
        val coordinator = FirstDeviceTrustRootCoordinator(
            rootStore = rig.store,
            apiClient = rig.api,
            signatureEngine = rig.engine,
            evidenceSource = rig.evidence,
        )
        val replacement = expired.copy(
            seed = expired.seed.copy(
                attemptId = "b".repeat(32),
                attemptRecoveryToken = "s".repeat(43),
                deviceId = "device-2",
                dskAlias = "pca.dsk." + "b".repeat(32),
                dekAlias = "pca.dek." + "b".repeat(32),
            ),
            state = FirstDeviceRootState.NOT_STARTED,
            ceremonyId = null,
            challengeId = null,
            nonce = null,
            expiresAt = null,
            familyId = null,
            submission = null,
            committedAtMillis = null,
        )
        rig.api.onBeforeChallengeReturn = {
            assertTrue(
                rig.store.captureSeed(
                    replacement,
                    setOf(FirstDeviceRootState.EXPIRED, FirstDeviceRootState.REJECTED),
                ),
            )
        }

        coordinator.beginCeremony()

        assertEquals(1, rig.api.challengeCalls.size)
        assertEquals(replacement, rig.store.current())
        assertEquals(expired, coordinator.record.value)
    }

    @Test
    fun `submit is not sent when durable flush fails`() = runTest {
        val backing = FailingFlushStore()
        val rootStore = PersistentFirstDeviceRootStore(backing)
        val seed = Rig().seed
        val approved = FirstDeviceRootRecord(
            seed = seed,
            state = FirstDeviceRootState.APPROVED,
            ceremonyId = "ceremony-1",
            challengeId = "challenge-1",
            nonce = "n".repeat(43),
            expiresAt = "2026-10-02T01:00:00.000Z",
            familyId = "family-1",
        )
        rootStore.save(approved)
        backing.failNextFlush = true
        val api = FakeApi()
        val coordinator = FirstDeviceTrustRootCoordinator(
            rootStore = rootStore,
            apiClient = api,
            signatureEngine = FakeEngine(),
            evidenceSource = FakeEvidenceSource(),
        )

        coordinator.submit()

        assertTrue(api.submitCalls.isEmpty())
        assertEquals(approved, coordinator.record.value)
    }

    private class FailingFlushStore : org.pca.app.foundation.PersistentStateStore {
        private val values = mutableMapOf<String, String>()
        var failNextFlush = false
        override fun getString(key: String): String? = values[key]
        override fun putString(key: String, value: String) { values[key] = value }
        override fun remove(key: String) { values.remove(key) }
        override fun contains(key: String): Boolean = values.containsKey(key)
        override fun clear() { values.clear() }
        override fun flush() {
            if (failNextFlush) {
                failNextFlush = false
                throw IllegalStateException("injected durable commit failure")
            }
        }
    }
}
