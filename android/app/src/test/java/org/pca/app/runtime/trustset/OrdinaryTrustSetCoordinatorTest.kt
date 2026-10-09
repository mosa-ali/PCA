package org.pca.app.runtime.trustset

import java.util.Base64
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import org.pca.app.firstdevice.FirstDeviceAcceptedEpochAnchor
import org.pca.app.firstdevice.FirstDeviceCeremonySeed
import org.pca.app.firstdevice.FirstDeviceRootRecord
import org.pca.app.firstdevice.FirstDeviceRootState
import org.pca.app.firstdevice.InMemoryFirstDeviceRootStore
import org.pca.app.foundation.InMemoryPersistentStateStore
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
        assertTrue(store.compareAndSetDurably(current, current.copy(pending = request)))
    }
    private class Api : OrdinaryTrustSetApi {
        val sent = mutableListOf<OrdinaryEpochRequest>()
        var loseResponse = false
        var response: OrdinaryEpochResponse? = null
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
            return response!!.acceptedHead
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
    @Test fun restartAndLostResponseReuseExactPersistedSignature() = runBlocking {
        val backing = InMemoryPersistentStateStore()
        val store = PersistentOrdinaryEpochStore(backing)
        seedStore(store)
        val api = Api().apply { loseResponse = true }
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
    @Test fun flushedPendingSurvivesProcessDeathAndFailedFlushNeverSends() = runBlocking {
        val backing = DiskBackedPersistentStateStore()
        val store = PersistentOrdinaryEpochStore(backing)
        seedStore(store)
        val api = Api().apply { loseResponse = true }
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
        val nextOwner = epoch(2).entries.single().copy(deviceId = "second", dskKeyId = "second-dsk", dskPublicKey = "second-public",
            dekKeyId = "second-dek", dekPublicKey = "second-dek-public")
        val transfer = record(epoch(2).copy(entries = listOf(nextOwner)))
        val later = record(epoch(3).copy(entries = listOf(nextOwner))).copy(signerDeviceId = "second", signerKeyId = "second-dsk")
        val api = Api().apply { records[2] = transfer; response = OrdinaryEpochResponse(OrdinaryEpochOutcome.ACCEPTED, later, later) }
        val keys = mutableListOf<String>()
        val signer = object : DskSignatureEngine { override fun signCanonicalDer(alias: String, message: ByteArray): ByteArray = error("no resign") }
        val coordinator = OrdinaryTrustSetCoordinator(store, api, signer, OrdinaryEpochSignatureVerifier { key, _, _ -> keys.add(key); true }, "owner", "dsk", "alias")
        try { coordinator.catchUp(2); fail() } catch (_: IllegalArgumentException) { }
        assertTrue(keys.isNotEmpty())
        assertTrue("root and floor checks must use the trusted owner's DSK", keys.all { it == "public-dsk" })
        assertEquals(1, store.read()!!.accepted.trustSetEpoch)
    }
}
