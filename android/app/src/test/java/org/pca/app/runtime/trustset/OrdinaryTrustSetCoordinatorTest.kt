package org.pca.app.runtime.trustset

import java.util.Base64
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
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
    private class Api : OrdinaryTrustSetApi {
        val sent = mutableListOf<OrdinaryEpochRequest>()
        var loseResponse = false
        var response: OrdinaryEpochResponse? = null
        val records = mutableMapOf<Int, AcceptedEpochRecord>()
        override suspend fun submit(familyId: String, request: OrdinaryEpochRequest): OrdinaryEpochResponse {
            sent += request
            if (loseResponse) throw java.io.IOException("timeout")
            return response!!
        }
        override suspend fun status(familyId: String, request: OrdinaryEpochRequest) = submit(familyId, request)
        override suspend fun getEpoch(familyId: String, trustSetEpoch: Int) = records[trustSetEpoch] ?: response!!.acceptedHead
        override suspend fun getHead(familyId: String) = response!!.acceptedHead
    }
    @Test fun restartAndLostResponseReuseExactPersistedSignature() = runBlocking {
        val backing = InMemoryPersistentStateStore()
        val store = PersistentOrdinaryEpochStore(backing)
        store.compareAndSetDurably(null, OrdinaryEpochState(record(epoch(1))))
        val api = Api().apply { loseResponse = true }
        var signs = 0
        val signer = object : DskSignatureEngine { override fun signCanonicalDer(alias: String, message: ByteArray): ByteArray {
            signs++; return ByteArray(64) { signs.toByte() }
        } }
        fun coordinator() = OrdinaryTrustSetCoordinator(PersistentOrdinaryEpochStore(backing), api, signer,
            OrdinaryEpochSignatureVerifier { _, _, _ -> true }, "owner", "dsk", "alias")
        assertTrue(coordinator().prepare(epoch(2)))
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
    }
    @Test fun corruptCustodyCannotBecomeAnEmptyInstall() {
        val backing = InMemoryPersistentStateStore().apply { putString("ordinary_trust_set_v1", "bad") }
        try { PersistentOrdinaryEpochStore(backing).read(); fail() } catch (_: IllegalStateException) { }
    }
    @Test fun compareAndSetCannotOverwriteAnotherWriter() {
        val store = PersistentOrdinaryEpochStore(InMemoryPersistentStateStore())
        val initial = OrdinaryEpochState(record(epoch(1)))
        assertTrue(store.compareAndSetDurably(null, initial))
        assertFalse(store.compareAndSetDurably(null, OrdinaryEpochState(record(epoch(2)))))
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
        store.compareAndSetDurably(null, OrdinaryEpochState(record(epoch(1)), accepted.request))
        val api = Api().apply { response = OrdinaryEpochResponse(OrdinaryEpochOutcome.ACCEPTED, accepted, accepted) }
        val signer = object : DskSignatureEngine { override fun signCanonicalDer(alias: String, message: ByteArray): ByteArray = error("no resign") }
        val coordinator = OrdinaryTrustSetCoordinator(store, api, signer, OrdinaryEpochSignatureVerifier { _, _, _ -> false }, "owner", "dsk", "alias")
        try { coordinator.reconcile(); fail() } catch (_: IllegalArgumentException) { }
        assertEquals(accepted.request, store.read()!!.pending)
        assertEquals(1, store.read()!!.accepted.trustSetEpoch)
    }
    @Test fun rollbackAndCrossFamilyAreRejectedBeforeSigning() = runBlocking {
        val store = PersistentOrdinaryEpochStore(InMemoryPersistentStateStore())
        store.compareAndSetDurably(null, OrdinaryEpochState(record(epoch(1))))
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
        store.compareAndSetDurably(null, OrdinaryEpochState(record(epoch(1)), accepted.request))
        val api = Api().apply { response = OrdinaryEpochResponse(OrdinaryEpochOutcome.ACCEPTED, accepted, accepted) }
        val signer = object : DskSignatureEngine { override fun signCanonicalDer(alias: String, message: ByteArray): ByteArray = error("no resign") }
        val coordinator = OrdinaryTrustSetCoordinator(store, api, signer, OrdinaryEpochSignatureVerifier { _, _, _ -> true }, "owner", "dsk", "alias")
        assertEquals(1, coordinator.catchUp(1))
        assertEquals(2, store.read()!!.accepted.trustSetEpoch)
        assertNull(store.read()!!.pending)
    }
    @Test fun signedHeadMaySkipNumbersButMustLinkToTrustedPredecessor() = runBlocking {
        val store = PersistentOrdinaryEpochStore(InMemoryPersistentStateStore())
        store.compareAndSetDurably(null, OrdinaryEpochState(record(epoch(1))))
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
        store.compareAndSetDurably(null, OrdinaryEpochState(record(epoch(1))))
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
        store.compareAndSetDurably(null, OrdinaryEpochState(record(epoch(1))))
        val nextOwner = epoch(2).entries.single().copy(deviceId = "second", dskKeyId = "second-dsk", dskPublicKey = "second-public",
            dekKeyId = "second-dek", dekPublicKey = "second-dek-public")
        val transfer = record(epoch(2).copy(entries = listOf(nextOwner)))
        val later = record(epoch(3).copy(entries = listOf(nextOwner))).copy(signerDeviceId = "second", signerKeyId = "second-dsk")
        val api = Api().apply { records[2] = transfer; response = OrdinaryEpochResponse(OrdinaryEpochOutcome.ACCEPTED, later, later) }
        val keys = mutableListOf<String>()
        val signer = object : DskSignatureEngine { override fun signCanonicalDer(alias: String, message: ByteArray): ByteArray = error("no resign") }
        val coordinator = OrdinaryTrustSetCoordinator(store, api, signer, OrdinaryEpochSignatureVerifier { key, _, _ -> keys.add(key); true }, "owner", "dsk", "alias")
        try { coordinator.catchUp(2); fail() } catch (_: IllegalArgumentException) { }
        assertTrue(keys.isEmpty())
        assertEquals(1, store.read()!!.accepted.trustSetEpoch)
    }
}
