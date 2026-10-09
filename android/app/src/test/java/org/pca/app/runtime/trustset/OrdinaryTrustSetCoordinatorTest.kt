package org.pca.app.runtime.trustset

import java.util.Base64
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.pca.app.firstdevice.FirstDeviceAcceptedEpochAnchor
import org.pca.app.firstdevice.FirstDeviceCeremonySeed
import org.pca.app.firstdevice.FirstDeviceRootRecord
import org.pca.app.firstdevice.FirstDeviceRootState
import org.pca.app.firstdevice.InMemoryFirstDeviceRootStore
import org.pca.app.foundation.InMemoryPersistentStateStore
import org.pca.app.foundation.PersistentStateStore
import org.pca.app.security.DskSignatureEngine
import org.pca.app.runtime.schedule.DiskBackedPersistentStateStore

class OrdinaryTrustSetCoordinatorTest {
    private fun epoch(number: Int) = UntrustedTrustSetEpoch("family", number, 1, listOf(UntrustedTrustSetEntry(
        "owner", TrustSetRole.OWNER, "dsk", "public-dsk", "dek", "public-dek", TrustSetMembershipStatus.ACTIVE)),
        "2026-10-09T00:00:00.000Z", if(number == 1) null else number - 1)
    private fun record(epoch: UntrustedTrustSetEpoch) = AcceptedEpochRecord(OrdinaryEpochRequest(
        Base64.getEncoder().encodeToString(TrustSetEpochCodec.canonicalize(epoch).toByteArray()),
        Base64.getEncoder().encodeToString(ByteArray(64) { 1 })), "owner", "dsk", epoch.trustSetEpoch, epoch.keyEpoch)
    private val rootSeed = FirstDeviceCeremonySeed("a".repeat(32), "", "https://example.test", "owner", "dsk", "dek",
        "public-dsk", "public-dek", "pca.dsk." + "a".repeat(32), "pca.dek." + "a".repeat(32))
    private fun seedStore(store: PersistentOrdinaryEpochStore) {
        val root = record(epoch(1))
        val rootBytes = Base64.getDecoder().decode(root.request.canonicalEpochBase64)
        val signatureUrl = Base64.getUrlEncoder().withoutPadding().encodeToString(ByteArray(64) { 1 })
        val roots = InMemoryFirstDeviceRootStore().apply {
            save(FirstDeviceRootRecord(rootSeed, FirstDeviceRootState.ROOT_COMMITTED, familyId = "family",
                committedAtMillis = 123L,
                acceptedEpoch1 = FirstDeviceAcceptedEpochAnchor(String(rootBytes, Charsets.UTF_8), signatureUrl)))
        }
        OrdinaryTrustSetBootstrapAnchor.seed(roots, store, OrdinaryEpochSignatureVerifier { _, _, _ -> true })
    }
    private fun installPending(store: PersistentOrdinaryEpochStore, request: OrdinaryEpochRequest) {
        seedStore(store)
        val current = store.read()!!
        assertTrue(store.compareAndSetDurably(current, current.copy(pending = request, pendingBase = current.accepted)))
    }
    private fun legacyV2Store(
        backing: PersistentStateStore,
        accepted: AcceptedEpochRecord,
        root: AcceptedEpochRecord,
        pending: OrdinaryEpochRequest,
    ): PersistentOrdinaryEpochStore {
        fun requestJson(value: OrdinaryEpochRequest) = JSONObject()
            .put("canonicalEpochBase64", value.canonicalEpochBase64)
            .put("signatureBase64", value.signatureBase64)
        fun acceptedJson(value: AcceptedEpochRecord) = requestJson(value.request)
            .put("signerDeviceId", value.signerDeviceId)
            .put("signerKeyId", value.signerKeyId)
            .put("trustSetEpoch", value.trustSetEpoch)
            .put("keyEpoch", value.keyEpoch)
        backing.putString("ordinary_trust_set_v1", JSONObject()
            .put("version", 2)
            .put("accepted", acceptedJson(accepted))
            .put("rootAnchor", acceptedJson(root))
            .put("pending", requestJson(pending))
            .toString())
        return PersistentOrdinaryEpochStore(backing)
    }
    private class Api : OrdinaryTrustSetApi {
        val sent = mutableListOf<OrdinaryEpochRequest>()
        var loseResponse = false
        var response: OrdinaryEpochResponse? = null
        var head: AcceptedEpochRecord? = null
        var headReads = 0
        val records = mutableMapOf<Int, AcceptedEpochRecord>()
        override suspend fun submit(familyId: String, request: OrdinaryEpochRequest): OrdinaryEpochResponse {
            sent += request
            if (loseResponse) throw java.io.IOException("timeout")
            return response!!
        }
        override suspend fun status(familyId: String, request: OrdinaryEpochRequest) = submit(familyId, request)
        override suspend fun getEpoch(familyId: String, trustSetEpoch: Int) = records[trustSetEpoch] ?: response!!.acceptedHead
        override suspend fun getHead(familyId: String): AcceptedEpochRecord {
            headReads++
            return head ?: response!!.acceptedHead
        }
    }
    private class MemoryStore(var state: OrdinaryEpochState) : OrdinaryEpochStore {
        override fun read() = state
        override fun compareAndSetDurably(expected: OrdinaryEpochState?, next: OrdinaryEpochState): Boolean {
            if (state != expected) return false
            state = next
            return true
        }
        override fun confirmDurable(expected: OrdinaryEpochState) = state == expected
    }

    @Test fun `prepare and catch up reject forged or stale bootstrap and accepted floors`() = runBlocking {
        val root = record(epoch(1))
        val rootBytes = Base64.getDecoder().decode(root.request.canonicalEpochBase64)
        val rootSignature = root.request.signatureBase64
        val verifier = OrdinaryEpochSignatureVerifier { _, bytes, signature ->
            bytes.contentEquals(rootBytes) && signature == rootSignature
        }
        var signs = 0
        val signer = object : DskSignatureEngine {
            override fun signCanonicalDer(alias: String, message: ByteArray): ByteArray {
                signs++
                return ByteArray(64) { 1 }
            }
        }
        val api = Api()
        val forgedRoot = root.copy(request = root.request.copy(
            signatureBase64 = Base64.getEncoder().encodeToString(ByteArray(64) { 2 }),
        ))
        val forgedStore = MemoryStore(OrdinaryEpochState(root, rootAnchor = forgedRoot))
        val forgedCoordinator = OrdinaryTrustSetCoordinator(forgedStore, api, signer, verifier, "owner", "dsk", "alias")
        assertFalse(forgedCoordinator.prepare(epoch(2)))
        assertEquals(0, forgedCoordinator.catchUp())
        assertEquals(0, signs)
        assertEquals(0, api.headReads)

        // Even a valid signature cannot make a different epoch-1 record a trusted floor.
        val staleAccepted = root.copy(request = root.request.copy(
            signatureBase64 = Base64.getEncoder().encodeToString(ByteArray(64) { 3 }),
        ))
        val staleStore = MemoryStore(OrdinaryEpochState(staleAccepted, rootAnchor = root))
        val permissiveVerifier = OrdinaryEpochSignatureVerifier { _, _, _ -> true }
        val staleCoordinator = OrdinaryTrustSetCoordinator(staleStore, api, signer, permissiveVerifier,
            "owner", "dsk", "alias")
        assertFalse(staleCoordinator.prepare(epoch(2)))
        assertEquals(0, staleCoordinator.catchUp())
        assertEquals(0, signs)
        assertEquals(0, api.headReads)

        // A valid epoch-1 anchor does not authorize a forged accepted epoch-N signing floor.
        val forgedAccepted = record(epoch(2)).copy(request = record(epoch(2)).request.copy(
            signatureBase64 = Base64.getEncoder().encodeToString(ByteArray(64) { 4 }),
        ))
        val forgedAcceptedStore = MemoryStore(OrdinaryEpochState(forgedAccepted, rootAnchor = root))
        val forgedAcceptedCoordinator = OrdinaryTrustSetCoordinator(forgedAcceptedStore, api, signer, verifier,
            "owner", "dsk", "alias")
        assertFalse(forgedAcceptedCoordinator.prepare(epoch(3)))
        assertEquals(0, forgedAcceptedCoordinator.catchUp())
        assertEquals(0, signs)
        assertEquals(0, api.headReads)
    }
    @Test fun signedButUnacceptedLocalFloorCannotAuthorizeAnotherDskSignature() = runBlocking {
        val root = record(epoch(1))
        val phantomFloor = record(epoch(2))
        val store = MemoryStore(OrdinaryEpochState(phantomFloor, rootAnchor = root))
        val api = Api().apply { head = root }
        var signs = 0
        val signer = object : DskSignatureEngine {
            override fun signCanonicalDer(alias: String, message: ByteArray): ByteArray {
                signs++
                return ByteArray(64) { 9 }
            }
        }
        val coordinator = OrdinaryTrustSetCoordinator(store, api, signer,
            OrdinaryEpochSignatureVerifier { _, _, _ -> true }, "owner", "dsk", "alias")

        assertFalse(coordinator.prepare(epoch(3)))

        assertEquals(1, api.headReads)
        assertEquals(0, signs)
        assertNull(store.read()!!.pending)
        assertEquals(phantomFloor, store.read()!!.accepted)
        assertTrue(api.sent.isEmpty())
    }
    @Test fun restartAndLostResponseReuseExactPersistedSignature() = runBlocking {
        val backing = InMemoryPersistentStateStore()
        val store = PersistentOrdinaryEpochStore(backing)
        seedStore(store)
        val api = Api().apply { loseResponse = true; head = record(epoch(1)) }
        var signs = 0
        val signer = object : DskSignatureEngine { override fun signCanonicalDer(alias: String, message: ByteArray): ByteArray {
            signs++; return ByteArray(64) { signs.toByte() }
        } }
        fun coordinator() = OrdinaryTrustSetCoordinator(PersistentOrdinaryEpochStore(backing), api, signer,
            OrdinaryEpochSignatureVerifier { _, _, _ -> true }, "owner", "dsk", "alias")
        assertTrue(coordinator().prepare(epoch(2)))
        val bootstrapAnchor = store.read()!!.rootAnchor
        assertFalse(coordinator().submitExact())
        assertFalse(coordinator().prepare(epoch(2)))
        assertFalse(coordinator().submitExact())
        assertEquals(1, signs)
        assertEquals(api.sent[0], api.sent[1])
        val accepted = record(epoch(2)).copy(request = api.sent[0])
        api.loseResponse = false
        api.response = OrdinaryEpochResponse(OrdinaryEpochOutcome.ACCEPTED, accepted, accepted)
        assertTrue(coordinator().reconcile())
        assertNull(store.read()!!.pending)
        assertEquals(2, store.read()!!.accepted.trustSetEpoch)
        assertEquals(bootstrapAnchor, store.read()!!.rootAnchor)
    }
    @Test fun exactStatusProofAdvancesPendingBeforeNewerHeadCatchUp() = runBlocking {
        val store = PersistentOrdinaryEpochStore(InMemoryPersistentStateStore())
        val acceptedPending = record(epoch(2))
        installPending(store, acceptedPending.request)
        val advancedHead = record(epoch(3))
        val api = Api().apply {
            response = OrdinaryEpochResponse(OrdinaryEpochOutcome.ACCEPTED, acceptedPending, advancedHead)
        }
        var signs = 0
        val signer = object : DskSignatureEngine {
            override fun signCanonicalDer(alias: String, message: ByteArray): ByteArray {
                signs++
                return ByteArray(64) { 2 }
            }
        }
        val coordinator = OrdinaryTrustSetCoordinator(store, api, signer,
            OrdinaryEpochSignatureVerifier { _, _, _ -> true }, "owner", "dsk", "alias")

        assertTrue("exact accepted request should clear even when the projected head advanced", coordinator.reconcile())
        assertEquals(acceptedPending, store.read()!!.accepted)
        assertNull(store.read()!!.pending)
        assertEquals(0, signs)

        // The next reconciliation verifies the newer head from the now-durable epoch-2 floor.
        api.response = OrdinaryEpochResponse(OrdinaryEpochOutcome.ACCEPTED, advancedHead, advancedHead)
        assertEquals(1, coordinator.catchUp(1))
        assertEquals(advancedHead, store.read()!!.accepted)
        assertNull(store.read()!!.pending)
    }
    @Test fun corruptCustodyCannotBecomeAnEmptyInstall() {
        val backing = InMemoryPersistentStateStore().apply { putString("ordinary_trust_set_v1", "bad") }
        try { PersistentOrdinaryEpochStore(backing).read(); fail() } catch (_: IllegalStateException) { }
    }
    @Test fun compareAndSetCannotOverwriteAnotherWriter() {
        val store = PersistentOrdinaryEpochStore(InMemoryPersistentStateStore())
        seedStore(store)
        val initial = store.read()!!
        assertFalse(store.compareAndSetDurably(null, OrdinaryEpochState(record(epoch(2)), rootAnchor = initial.rootAnchor)))
        assertEquals(initial, store.read())
    }
    @Test fun unavailablePersistencePreventsSigningAndNetwork() = runBlocking {
        val api = Api()
        val store = object : OrdinaryEpochStore {
            override fun read() = OrdinaryEpochState(record(epoch(1)), record(epoch(2)).request)
            override fun compareAndSetDurably(expected: OrdinaryEpochState?, next: OrdinaryEpochState) = false
            override fun confirmDurable(expected: OrdinaryEpochState) = false
        }
        val signer = object : DskSignatureEngine { override fun signCanonicalDer(alias: String, message: ByteArray): ByteArray = error("must not sign") }
        val coordinator = OrdinaryTrustSetCoordinator(store, api, signer, OrdinaryEpochSignatureVerifier { _, _, _ -> true }, "owner", "dsk", "alias")
        assertFalse(coordinator.submitExact())
        assertTrue(api.sent.isEmpty())
    }
    @Test fun unverifiedServerAcceptanceRetainsPending() = runBlocking {
        val store = PersistentOrdinaryEpochStore(InMemoryPersistentStateStore())
        val accepted = record(epoch(2))
        installPending(store, accepted.request)
        val api = Api().apply { response = OrdinaryEpochResponse(OrdinaryEpochOutcome.ACCEPTED, accepted, accepted) }
        val signer = object : DskSignatureEngine { override fun signCanonicalDer(alias: String, message: ByteArray): ByteArray = error("no resign") }
        val root = store.read()!!.accepted
        val rootBytes = Base64.getDecoder().decode(root.request.canonicalEpochBase64)
        val coordinator = OrdinaryTrustSetCoordinator(store, api, signer, OrdinaryEpochSignatureVerifier { _, bytes, signature ->
            bytes.contentEquals(rootBytes) && signature == root.request.signatureBase64
        }, "owner", "dsk", "alias")
        try { coordinator.reconcile(); fail() } catch (_: IllegalArgumentException) { }
        assertEquals(accepted.request, store.read()!!.pending)
        assertEquals(1, store.read()!!.accepted.trustSetEpoch)
    }
    @Test fun rollbackAndCrossFamilyAreRejectedBeforeSigning() = runBlocking {
        val store = PersistentOrdinaryEpochStore(InMemoryPersistentStateStore())
        seedStore(store)
        val signer = object : DskSignatureEngine { override fun signCanonicalDer(alias: String, message: ByteArray): ByteArray = error("must not sign") }
        val coordinator = OrdinaryTrustSetCoordinator(store, Api(), signer, OrdinaryEpochSignatureVerifier { _, _, _ -> true }, "owner", "dsk", "alias")
        for (candidate in listOf(epoch(1), epoch(2).copy(familyId = "other"), epoch(2).copy(keyEpoch = 0))) {
            try { coordinator.prepare(candidate); fail() } catch (_: IllegalArgumentException) { }
        }
        assertNull(store.read()!!.pending)
    }
    @Test fun verifiedCatchUpPersistsFloorAndClearsOnlyExactPending() = runBlocking {
        val store = PersistentOrdinaryEpochStore(InMemoryPersistentStateStore())
        val accepted = record(epoch(2))
        installPending(store, accepted.request)
        val bootstrapAnchor = store.read()!!.rootAnchor
        val api = Api().apply { response = OrdinaryEpochResponse(OrdinaryEpochOutcome.ACCEPTED, accepted, accepted) }
        val signer = object : DskSignatureEngine { override fun signCanonicalDer(alias: String, message: ByteArray): ByteArray = error("no resign") }
        val coordinator = OrdinaryTrustSetCoordinator(store, api, signer, OrdinaryEpochSignatureVerifier { _, _, _ -> true }, "owner", "dsk", "alias")
        assertEquals(1, coordinator.catchUp(1))
        assertEquals(2, store.read()!!.accepted.trustSetEpoch)
        assertEquals(bootstrapAnchor, store.read()!!.rootAnchor)
        assertNull(store.read()!!.pending)
    }
    @Test fun pendingPredecessorSurvivesRestartBetweenVerifiedCatchUpHops() = runBlocking {
        val backing = InMemoryPersistentStateStore()
        val durable = PersistentOrdinaryEpochStore(backing)
        val pending = record(epoch(3).copy(supersedesEpoch = 1))
        installPending(durable, pending.request)
        val root = durable.read()!!.accepted
        val first = record(epoch(2))
        val head = record(epoch(3))
        val api = Api().apply { this.head = head; records[2] = first }
        var writes = 0
        val simulatedDeath = object : OrdinaryEpochStore {
            override fun read() = durable.read()
            override fun confirmDurable(expected: OrdinaryEpochState) = durable.confirmDurable(expected)
            override fun compareAndSetDurably(expected: OrdinaryEpochState?, next: OrdinaryEpochState): Boolean {
                writes++
                if (writes == 2) return false
                return durable.compareAndSetDurably(expected, next)
            }
        }
        val verifier = OrdinaryEpochSignatureVerifier { _, _, _ -> true }
        val noResign = object : DskSignatureEngine {
            override fun signCanonicalDer(alias: String, message: ByteArray): ByteArray = error("must not re-sign")
        }

        assertEquals(1, OrdinaryTrustSetCoordinator(simulatedDeath, api, noResign, verifier,
            "owner", "dsk", "alias").catchUp(2))
        assertEquals(first, durable.read()!!.accepted)
        assertEquals(pending.request, durable.read()!!.pending)
        assertEquals(root, durable.read()!!.pendingBase)

        val restarted = PersistentOrdinaryEpochStore(backing)
        assertFalse(OrdinaryTrustSetCoordinator(restarted, api, noResign, verifier,
            "owner", "dsk", "alias").submitExact())
        assertTrue("a request bound to an older floor must not be resent", api.sent.isEmpty())
        assertEquals(1, OrdinaryTrustSetCoordinator(restarted, api, noResign, verifier,
            "owner", "dsk", "alias").catchUp(2))
        assertEquals(head, restarted.read()!!.accepted)
        assertNull(restarted.read()!!.pending)
        assertNull(restarted.read()!!.pendingBase)
    }
    @Test fun legacyPendingIsRetiredOnlyAfterItsPredecessorIsProvenFromTheAcceptedChain() = runBlocking {
        val root = record(epoch(1))
        val acceptedFloor = record(epoch(2))
        val pending = record(epoch(3).copy(supersedesEpoch = 1)).request
        val competingAccepted = record(epoch(3))
        val backing = InMemoryPersistentStateStore()
        val store = legacyV2Store(backing, acceptedFloor, root, pending)
        val api = Api().apply {
            head = competingAccepted
            records[1] = root
            records[2] = acceptedFloor
        }
        val noResign = object : DskSignatureEngine {
            override fun signCanonicalDer(alias: String, message: ByteArray): ByteArray = error("must not re-sign")
        }

        assertEquals(1, OrdinaryTrustSetCoordinator(store, api, noResign,
            OrdinaryEpochSignatureVerifier { _, _, _ -> true }, "owner", "dsk", "alias").catchUp())
        assertEquals(competingAccepted, store.read()!!.accepted)
        assertNull("the v2 pending attempt is retired only after epoch 1 is resolved and verified", store.read()!!.pending)
        assertNull(store.read()!!.pendingBase)
    }
    @Test fun legacyPendingWithUnprovablePredecessorIsPreservedWhileServerCatchUpProgresses() = runBlocking {
        val root = record(epoch(1))
        val acceptedFloor = record(epoch(3).copy(supersedesEpoch = 1))
        val unprovablePending = record(epoch(4).copy(supersedesEpoch = 2)).request
        val serverHead = record(epoch(4).copy(supersedesEpoch = 3))
        val backing = InMemoryPersistentStateStore()
        val store = legacyV2Store(backing, acceptedFloor, root, unprovablePending)
        val api = Api().apply {
            head = serverHead
            records[3] = acceptedFloor
        }
        val noResign = object : DskSignatureEngine {
            override fun signCanonicalDer(alias: String, message: ByteArray): ByteArray = error("must not re-sign")
        }

        assertEquals(1, OrdinaryTrustSetCoordinator(store, api, noResign,
            OrdinaryEpochSignatureVerifier { _, _, _ -> true }, "owner", "dsk", "alias").catchUp())
        assertEquals(serverHead, store.read()!!.accepted)
        assertEquals("unproven legacy custody remains byte-for-byte intact", unprovablePending, store.read()!!.pending)
        assertNull("the current floor is not invented as the request's signing predecessor", store.read()!!.pendingBase)
    }
    @Test fun malformedPendingIsRejectedBeforeCatchUpNetworkOrFloorMutation() = runBlocking {
        val store = PersistentOrdinaryEpochStore(InMemoryPersistentStateStore())
        installPending(store, record(epoch(2)).request)
        val before = store.read()!!
        val rootBytes = Base64.getDecoder().decode(before.rootAnchor!!.request.canonicalEpochBase64)
        val rootSignature = before.rootAnchor.request.signatureBase64
        val api = Api().apply { head = record(epoch(2)) }
        val coordinator = OrdinaryTrustSetCoordinator(store, api,
            object : DskSignatureEngine { override fun signCanonicalDer(alias: String, message: ByteArray): ByteArray = error("no sign") },
            OrdinaryEpochSignatureVerifier { _, bytes, signature -> bytes.contentEquals(rootBytes) && signature == rootSignature },
            "owner", "dsk", "alias")

        try { coordinator.catchUp(); fail("malformed persisted pending request was accepted") } catch (_: IllegalArgumentException) { }
        assertEquals(before, store.read())
        assertEquals(0, api.headReads)
    }
    @Test fun verifiedSameEpochConflictRetiresPendingAndAllowsNextSigningAttempt() = runBlocking {
        val store = PersistentOrdinaryEpochStore(InMemoryPersistentStateStore())
        val localPending = record(epoch(2))
        installPending(store, localPending.request)
        val competing = record(epoch(2).copy(issuedAt = "2026-10-09T00:01:00.000Z"))
        assertNotEquals(localPending.request, competing.request)
        val api = Api().apply { response = OrdinaryEpochResponse(OrdinaryEpochOutcome.ACCEPTED, competing, competing) }
        val signer = object : DskSignatureEngine {
            override fun signCanonicalDer(alias: String, message: ByteArray) = ByteArray(64) { 2 }
        }
        val coordinator = OrdinaryTrustSetCoordinator(store, api, signer,
            OrdinaryEpochSignatureVerifier { _, _, _ -> true }, "owner", "dsk", "alias")

        assertEquals(1, coordinator.catchUp(1))
        assertEquals(competing, store.read()!!.accepted)
        assertNull("the server's immutable same-epoch conflict retires this exact pending attempt", store.read()!!.pending)
        assertTrue("a new attempt can proceed from the now-authoritative floor", coordinator.prepare(epoch(3)))
        assertNotNull(store.read()!!.pending)
    }
    @Test fun forgedSameEpochConflictCannotRetirePending() = runBlocking {
        val store = PersistentOrdinaryEpochStore(InMemoryPersistentStateStore())
        val localPending = record(epoch(2))
        installPending(store, localPending.request)
        val before = store.read()!!
        val competing = record(epoch(2).copy(issuedAt = "2026-10-09T00:01:00.000Z"))
        val api = Api().apply { response = OrdinaryEpochResponse(OrdinaryEpochOutcome.ACCEPTED, competing, competing) }
        val rootBytes = Base64.getDecoder().decode(before.accepted.request.canonicalEpochBase64)
        val rootSignature = before.accepted.request.signatureBase64
        val coordinator = OrdinaryTrustSetCoordinator(store, api,
            object : DskSignatureEngine { override fun signCanonicalDer(alias: String, message: ByteArray): ByteArray = error("must not sign") },
            OrdinaryEpochSignatureVerifier { _, bytes, signature -> bytes.contentEquals(rootBytes) && signature == rootSignature },
            "owner", "dsk", "alias")

        try { coordinator.catchUp(1); fail("unverified competing signature accepted") } catch (_: IllegalArgumentException) { }
        assertEquals(before, store.read())
        assertEquals(localPending.request, store.read()!!.pending)
    }
    @Test fun signedHeadMaySkipNumbersButMustLinkToTrustedPredecessor() = runBlocking {
        val store = PersistentOrdinaryEpochStore(InMemoryPersistentStateStore())
        seedStore(store)
        val skipped = record(epoch(5).copy(supersedesEpoch = 1))
        val api = Api().apply { response = OrdinaryEpochResponse(OrdinaryEpochOutcome.ACCEPTED, skipped, skipped) }
        val signer = object : DskSignatureEngine { override fun signCanonicalDer(alias: String, message: ByteArray): ByteArray = error("no resign") }
        val coordinator = OrdinaryTrustSetCoordinator(store, api, signer, OrdinaryEpochSignatureVerifier { _, _, _ -> true }, "owner", "dsk", "alias")
        assertEquals(1, coordinator.catchUp(1))
        assertEquals(5, store.read()!!.accepted.trustSetEpoch)
    }
    @Test fun nullSupersedesIsAcceptedAndPersistedEqualHeadMustMatchExactly() = runBlocking {
        val backing = DiskBackedPersistentStateStore()
        val store = PersistentOrdinaryEpochStore(backing)
        seedStore(store)
        val root = store.read()!!.rootAnchor!!
        val head = record(epoch(5).copy(supersedesEpoch = null))
        val rootBytes = Base64.getDecoder().decode(root.request.canonicalEpochBase64)
        val headBytes = Base64.getDecoder().decode(head.request.canonicalEpochBase64)
        val verifier = OrdinaryEpochSignatureVerifier { _, bytes, signature ->
            (bytes.contentEquals(rootBytes) && signature == root.request.signatureBase64) ||
                (bytes.contentEquals(headBytes) && signature == head.request.signatureBase64)
        }
        val api = Api().apply { this.head = head }
        val noResign = object : DskSignatureEngine {
            override fun signCanonicalDer(alias: String, message: ByteArray) = error("catch-up must not sign")
        }

        assertEquals(1, OrdinaryTrustSetCoordinator(store, api, noResign, verifier,
            "owner", "dsk", "alias").catchUp(1))
        assertEquals(head, store.read()!!.accepted)
        val durableAfterCatchUp = store.read()!!

        val restarted = PersistentOrdinaryEpochStore(backing.afterProcessDeath())
        assertEquals(0, OrdinaryTrustSetCoordinator(restarted, api, noResign, verifier,
            "owner", "dsk", "alias").catchUp(1))
        assertEquals(durableAfterCatchUp, restarted.read())

        // A same-epoch projection with a changed signature is not the durable head.
        api.head = head.copy(request = head.request.copy(
            signatureBase64 = Base64.getEncoder().encodeToString(ByteArray(64) { 2 })))
        try {
            OrdinaryTrustSetCoordinator(restarted, api, noResign, verifier,
                "owner", "dsk", "alias").catchUp(1)
            fail("tampered same-head record was adopted")
        } catch (_: IllegalArgumentException) { }
        assertEquals(durableAfterCatchUp, restarted.read())
    }
    @Test fun olderSupersedesBelowCurrentFloorDoesNotRequireInventedIntermediateRecords() = runBlocking {
        val root = record(epoch(1))
        val acceptedFloor = record(epoch(3).copy(supersedesEpoch = 1))
        val serverHead = record(epoch(8).copy(supersedesEpoch = 2))
        val store = MemoryStore(OrdinaryEpochState(acceptedFloor, rootAnchor = root))
        val api = Api().apply { head = serverHead }
        val noResign = object : DskSignatureEngine {
            override fun signCanonicalDer(alias: String, message: ByteArray) = error("catch-up must not sign")
        }

        assertEquals(1, OrdinaryTrustSetCoordinator(store, api, noResign,
            OrdinaryEpochSignatureVerifier { _, _, _ -> true }, "owner", "dsk", "alias").catchUp(1))
        assertEquals(serverHead, store.read()!!.accepted)
        assertEquals(0, api.records.size)
    }
    @Test fun legacyNullLineagePendingCustodyStaysUnknownAcrossCatchUpAndRestart() = runBlocking {
        val root = record(epoch(1))
        val pending = record(epoch(5).copy(supersedesEpoch = null)).request
        val serverHead = record(epoch(4).copy(supersedesEpoch = null))
        val backing = DiskBackedPersistentStateStore()
        val store = legacyV2Store(backing, root, root, pending)
        val api = Api().apply { head = serverHead }
        val noResign = object : DskSignatureEngine {
            override fun signCanonicalDer(alias: String, message: ByteArray) = error("legacy pending must not re-sign")
        }
        fun coordinator(port: OrdinaryEpochStore) = OrdinaryTrustSetCoordinator(port, api, noResign,
            OrdinaryEpochSignatureVerifier { _, _, _ -> true }, "owner", "dsk", "alias")

        assertEquals(1, coordinator(store).catchUp(1))
        assertEquals(serverHead, store.read()!!.accepted)
        assertEquals(pending, store.read()!!.pending)
        assertNull(store.read()!!.pendingBase)
        assertFalse(coordinator(store).submitExact())
        assertTrue(api.sent.isEmpty())

        val restarted = PersistentOrdinaryEpochStore(backing.afterProcessDeath())
        assertEquals(pending, restarted.read()!!.pending)
        assertNull(restarted.read()!!.pendingBase)
        assertFalse(coordinator(restarted).submitExact())
        assertTrue("unknown legacy custody is never submitted after restart", api.sent.isEmpty())
    }
    @Test fun persistedPendingBaseCannotBeReboundByOlderSignedLineageMetadata() = runBlocking {
        val root = record(epoch(1))
        val accepted = record(epoch(3).copy(supersedesEpoch = 1))
        val claimedBase = record(epoch(2))
        val pending = record(epoch(4).copy(supersedesEpoch = 1)).request
        val initial = OrdinaryEpochState(accepted, pending, rootAnchor = root, pendingBase = claimedBase)
        val store = MemoryStore(initial)
        val api = Api().apply { head = accepted }
        val noResign = object : DskSignatureEngine {
            override fun signCanonicalDer(alias: String, message: ByteArray) = error("pending request must not be re-signed")
        }

        try {
            OrdinaryTrustSetCoordinator(store, api, noResign,
                OrdinaryEpochSignatureVerifier { _, _, _ -> true }, "owner", "dsk", "alias").catchUp()
            fail("signed older lineage metadata was allowed to replace the exact durable signing base")
        } catch (_: IllegalArgumentException) { }
        assertEquals(initial, store.read())
        assertEquals("invalid pending custody is rejected before network reconciliation", 0, api.headReads)
    }
    @Test fun flushedPendingSurvivesProcessDeathAndFailedFlushNeverSends() = runBlocking {
        val backing = DiskBackedPersistentStateStore()
        val store = PersistentOrdinaryEpochStore(backing)
        seedStore(store)
        val api = Api().apply { loseResponse = true; head = record(epoch(1)) }
        var signs = 0
        val signer = object : DskSignatureEngine { override fun signCanonicalDer(alias: String, message: ByteArray): ByteArray {
            signs++; return ByteArray(64) { 1 }
        } }
        fun coordinator(port: OrdinaryEpochStore) = OrdinaryTrustSetCoordinator(port, api, signer,
            OrdinaryEpochSignatureVerifier { _, _, _ -> true }, "owner", "dsk", "alias")
        assertTrue(coordinator(store).prepare(epoch(2)))
        val restarted = PersistentOrdinaryEpochStore(backing.afterProcessDeath())
        assertEquals(store.read(), restarted.read())
        assertFalse(coordinator(restarted).submitExact())
        assertEquals(store.read()!!.pending, api.sent.single())
        assertEquals(1, signs)
        val failedBacking = DiskBackedPersistentStateStore(backing.durableSnapshot()).apply { failFlushNumbers = setOf(1) }
        assertFalse(coordinator(PersistentOrdinaryEpochStore(failedBacking)).submitExact())
        assertEquals(1, api.sent.size)
    }
    @Test fun currentAcceptanceBoundaryRejectsOwnerTransfer() = runBlocking {
        val store = PersistentOrdinaryEpochStore(InMemoryPersistentStateStore())
        seedStore(store)
        val validFirst = record(epoch(2))
        val nextOwner = epoch(3).entries.single().copy(deviceId = "second", dskKeyId = "second-dsk", dskPublicKey = "second-public",
            dekKeyId = "second-dek", dekPublicKey = "second-dek-public")
        val later = record(epoch(3).copy(entries = listOf(nextOwner))).copy(signerDeviceId = "second", signerKeyId = "second-dsk")
        val api = Api().apply { records[2] = validFirst; response = OrdinaryEpochResponse(OrdinaryEpochOutcome.ACCEPTED, later, later) }
        val keys = mutableListOf<String>()
        val signer = object : DskSignatureEngine { override fun signCanonicalDer(alias: String, message: ByteArray): ByteArray = error("no resign") }
        val coordinator = OrdinaryTrustSetCoordinator(store, api, signer, OrdinaryEpochSignatureVerifier { key, _, _ -> keys.add(key); true }, "owner", "dsk", "alias")
        try { coordinator.catchUp(2); fail() } catch (_: IllegalArgumentException) { }
        assertTrue(keys.isNotEmpty())
        assertTrue("root and floor checks must use the trusted owner's DSK", keys.all { it == "public-dsk" })
        assertEquals("the complete chain is validated before any durable hop", 1, store.read()!!.accepted.trustSetEpoch)
    }
}
