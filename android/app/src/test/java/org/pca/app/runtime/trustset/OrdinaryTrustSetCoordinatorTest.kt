package org.pca.app.runtime.trustset

import java.util.Base64
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.launch
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
    private data class OwnerFixture(val deviceId: String, val keyId: String, val publicKey: String)

    private fun epoch(number: Int) = UntrustedTrustSetEpoch("family", number, 1, listOf(UntrustedTrustSetEntry(
        "owner", TrustSetRole.OWNER, "dsk", "public-dsk", "dek", "public-dek", TrustSetMembershipStatus.ACTIVE)),
        "2026-10-09T00:00:00.000Z", if(number == 1) null else number - 1)
    private fun epochWithOwner(
        number: Int,
        owner: OwnerFixture,
        priorOwner: OwnerFixture? = null,
        supersedesEpoch: Int? = if (number == 1) null else number - 1,
    ) =
        UntrustedTrustSetEpoch(
            familyId = "family",
            trustSetEpoch = number,
            keyEpoch = 1,
            entries = buildList {
                priorOwner?.let { previous -> add(UntrustedTrustSetEntry(
                    previous.deviceId, TrustSetRole.ADMINISTRATOR, previous.keyId, previous.publicKey,
                    "dek-${previous.deviceId}", "public-dek-${previous.deviceId}", TrustSetMembershipStatus.ACTIVE,
                )) }
                add(UntrustedTrustSetEntry(
                    owner.deviceId, TrustSetRole.OWNER, owner.keyId, owner.publicKey,
                    "dek-${owner.deviceId}", "public-dek-${owner.deviceId}", TrustSetMembershipStatus.ACTIVE,
                ))
            },
            issuedAt = "2026-10-09T00:00:00.000Z",
            supersedesEpoch = supersedesEpoch,
        )
    private fun record(epoch: UntrustedTrustSetEpoch) = AcceptedEpochRecord(OrdinaryEpochRequest(
        Base64.getEncoder().encodeToString(TrustSetEpochCodec.canonicalize(epoch).toByteArray()),
        Base64.getEncoder().encodeToString(ByteArray(64) { 1 })), "owner", "dsk", epoch.trustSetEpoch, epoch.keyEpoch)
    private fun record(epoch: UntrustedTrustSetEpoch, signer: OwnerFixture, request: OrdinaryEpochRequest) =
        record(epoch).copy(request = request, signerDeviceId = signer.deviceId, signerKeyId = signer.keyId)
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
    private fun legacyV3Store(
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
            .put("version", 3)
            .put("accepted", acceptedJson(accepted))
            .put("rootAnchor", acceptedJson(root))
            .put("pending", requestJson(pending))
            .put("pendingBase", JSONObject.NULL)
            .toString())
        return PersistentOrdinaryEpochStore(backing)
    }
    private class Api : OrdinaryTrustSetApi {
        val sent = mutableListOf<OrdinaryEpochRequest>()
        var loseResponse = false
        var response: OrdinaryEpochResponse? = null
        var head: AcceptedEpochRecord? = null
        var headReads = 0
        var epochReads = 0
        val records = mutableMapOf<Int, AcceptedEpochRecord>()
        override suspend fun submit(familyId: String, request: OrdinaryEpochRequest): OrdinaryEpochResponse {
            sent += request
            if (loseResponse) throw java.io.IOException("timeout")
            return response!!
        }
        override suspend fun status(familyId: String, request: OrdinaryEpochRequest) = submit(familyId, request)
        override suspend fun getEpoch(familyId: String, trustSetEpoch: Int): AcceptedEpochRecord {
            epochReads++
            return records[trustSetEpoch] ?: response!!.acceptedHead
        }
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

    @Test fun `accepted predecessor must verify under the immutable bootstrap owner`() = runBlocking {
        val root = record(epoch(1))
        val base = record(epoch(2))
        val accepted = record(epoch(3))
        val allowedSignedRecords = listOf(root, accepted).map { it.request.canonicalEpochBase64 }.toSet()
        val verifier = OrdinaryEpochSignatureVerifier { publicKey, bytes, signature ->
            publicKey == "public-dsk" &&
                Base64.getEncoder().encodeToString(bytes) in allowedSignedRecords &&
                signature == Base64.getEncoder().encodeToString(ByteArray(64) { 1 })
        }
        val store = MemoryStore(OrdinaryEpochState(
            accepted = accepted,
            rootAnchor = root,
            acceptedBase = base,
        ))
        val api = Api().apply { head = accepted }
        var signs = 0
        val signer = object : DskSignatureEngine {
            override fun signCanonicalDer(alias: String, message: ByteArray): ByteArray {
                signs++
                return ByteArray(64) { 1 }
            }
        }

        val coordinator = OrdinaryTrustSetCoordinator(store, api, signer, verifier, "owner", "dsk", "alias")
        assertFalse("a predecessor whose signature is not verified cannot authorize a new floor", coordinator.prepare(epoch(4)))
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

    @Test fun `same owner accepted epochs survive restart and rollback remains blocked`() = runBlocking {
        val ownerA = OwnerFixture("owner", "dsk", "public-dsk")
        val nextEpoch2 = epochWithOwner(2, ownerA)
        val nextEpoch3 = epochWithOwner(3, ownerA)
        val nextAsA = epochWithOwner(4, ownerA)
        val backing = InMemoryPersistentStateStore()
        val store = PersistentOrdinaryEpochStore(backing)
        seedStore(store)
        val root = requireNotNull(store.read()).accepted
        val api = Api().apply { head = root; loseResponse = true }
        var signs = 0
        val signer = object : DskSignatureEngine {
            override fun signCanonicalDer(alias: String, message: ByteArray): ByteArray {
                signs++
                return ByteArray(64) { signs.toByte() }
            }
        }
        val verifiedKeys = mutableListOf<String>()
        val verifier = OrdinaryEpochSignatureVerifier { publicKey, _, _ ->
            verifiedKeys += publicKey
            true
        }
        fun coordinator(owner: OwnerFixture) = OrdinaryTrustSetCoordinator(
            PersistentOrdinaryEpochStore(backing), api, signer, verifier,
            owner.deviceId, owner.keyId, "alias-${owner.deviceId}",
        )

        val firstOwner = coordinator(ownerA)
        assertTrue(firstOwner.prepare(nextEpoch2))
        val pending2 = requireNotNull(store.read()).pending
        assertNotNull(pending2)
        assertFalse(firstOwner.submitExact()) // response lost after durable signature

        val accepted2 = record(nextEpoch2, ownerA, requireNotNull(pending2))
        api.loseResponse = false
        api.response = OrdinaryEpochResponse(OrdinaryEpochOutcome.ACCEPTED, accepted2, accepted2)
        assertTrue(coordinator(ownerA).reconcile()) // new coordinator simulates process restart
        assertEquals(listOf(pending2, pending2), api.sent)
        assertEquals(root, requireNotNull(PersistentOrdinaryEpochStore(backing).read()).acceptedBase)

        api.head = accepted2
        assertTrue(coordinator(ownerA).prepare(nextEpoch3))
        val pending3 = requireNotNull(PersistentOrdinaryEpochStore(backing).read()).pending
        val accepted3 = record(nextEpoch3, ownerA, requireNotNull(pending3))
        api.response = OrdinaryEpochResponse(OrdinaryEpochOutcome.ACCEPTED, accepted3, accepted3)
        assertTrue(coordinator(ownerA).reconcile())
        val afterEpoch3 = requireNotNull(PersistentOrdinaryEpochStore(backing).read())
        assertEquals(accepted3, afterEpoch3.accepted)
        assertEquals(accepted2, afterEpoch3.acceptedBase)
        val staleSnapshot = requireNotNull(backing.getString("ordinary_trust_set_v1"))

        api.head = accepted3
        assertTrue(coordinator(ownerA).prepare(nextAsA))
        val pendingNext = requireNotNull(PersistentOrdinaryEpochStore(backing).read()).pending
        val acceptedNext = record(nextAsA, ownerA, requireNotNull(pendingNext))
        api.response = OrdinaryEpochResponse(OrdinaryEpochOutcome.ACCEPTED, acceptedNext, acceptedNext)
        assertTrue(coordinator(ownerA).reconcile())
        val finalState = requireNotNull(PersistentOrdinaryEpochStore(backing).read())

        assertEquals(acceptedNext, finalState.accepted)
        assertEquals(accepted3, finalState.acceptedBase)
        assertEquals(root, finalState.rootAnchor)
        assertEquals(3, signs)
        assertTrue("each accepted hop is checked under the unchanged ACTIVE Owner", verifiedKeys.contains(ownerA.publicKey))

        // Restoring the older authenticated pair cannot authorize a signature once the remote
        // accepted head has moved. The preflight detects the rollback before DSK use.
        backing.putString("ordinary_trust_set_v1", staleSnapshot)
        backing.flush()
        api.head = acceptedNext
        assertFalse(coordinator(ownerA).prepare(nextAsA))
        assertEquals(3, signs)
        assertEquals(4, api.headReads)
        assertEquals(accepted3, requireNotNull(PersistentOrdinaryEpochStore(backing).read()).accepted)
    }

    @Test fun `prepare rejects ordinary owner transfer before network signing or persistence`() = runBlocking {
        val ownerA = OwnerFixture("owner", "dsk", "public-dsk")
        val ownerB = OwnerFixture("device-b", "dsk-b", "public-dsk-b")
        val backing = InMemoryPersistentStateStore()
        val store = PersistentOrdinaryEpochStore(backing)
        seedStore(store)
        val root = requireNotNull(store.read()).accepted
        val api = Api().apply { head = root }
        var signs = 0
        val signer = object : DskSignatureEngine {
            override fun signCanonicalDer(alias: String, message: ByteArray): ByteArray {
                signs++
                return ByteArray(64) { 7 }
            }
        }
        val coordinator = OrdinaryTrustSetCoordinator(
            store, api, signer, OrdinaryEpochSignatureVerifier { _, _, _ -> true },
            ownerA.deviceId, ownerA.keyId, "alias-owner-a",
        )
        val transferToB = epochWithOwner(2, ownerB, ownerA)
        try {
            coordinator.prepare(transferToB)
            fail("ordinary transport must not transfer the ACTIVE Owner")
        } catch (_: IllegalArgumentException) { }

        assertEquals(root, store.read()!!.accepted)
        assertNull(store.read()!!.pending)
        assertEquals(0, api.headReads)
        assertEquals(0, signs)
    }

    @Test fun `catch-up rejects a projected owner transfer and preserves local custody`() = runBlocking {
        val ownerA = OwnerFixture("owner", "dsk", "public-dsk")
        val ownerB = OwnerFixture("device-b", "dsk-b", "public-dsk-b")
        val backing = InMemoryPersistentStateStore()
        val store = PersistentOrdinaryEpochStore(backing)
        seedStore(store)
        val root = requireNotNull(store.read()).accepted
        val api = Api().apply { head = root; records[1] = root }
        var signs = 0
        val signer = object : DskSignatureEngine {
            override fun signCanonicalDer(alias: String, message: ByteArray): ByteArray {
                signs++
                return ByteArray(64) { 8 }
            }
        }
        val coordinator = OrdinaryTrustSetCoordinator(
            store, api, signer,
            OrdinaryEpochSignatureVerifier { _, _, _ -> true }, ownerA.deviceId, ownerA.keyId, "alias-owner-a",
        )
        assertTrue(coordinator.prepare(epochWithOwner(number = 5, owner = ownerA, supersedesEpoch = 1)))
        val before = requireNotNull(store.read())
        val transfer = epochWithOwner(2, ownerB, ownerA)
        val acceptedTransfer = record(transfer, ownerA, record(transfer).request)
        api.head = acceptedTransfer
        api.records[2] = acceptedTransfer

        try {
            coordinator.catchUp()
            fail("a server projection cannot make ordinary Owner transfer valid")
        } catch (_: IllegalArgumentException) { }

        assertEquals(before, store.read())
        assertTrue("catch-up never submits pending custody", api.sent.isEmpty())
        assertEquals(1, signs)
    }

    @Test fun `verified same-owner head advance retires pending custody bound to its prior floor`() = runBlocking {
        val ownerA = OwnerFixture("owner", "dsk", "public-dsk")
        val backing = InMemoryPersistentStateStore()
        val store = PersistentOrdinaryEpochStore(backing)
        seedStore(store)
        val root = requireNotNull(store.read()).accepted
        val pendingEpoch = epochWithOwner(number = 5, owner = ownerA, supersedesEpoch = 1)
        val original = requireNotNull(store.read())
        assertTrue(store.compareAndSetDurably(
            original,
            original.copy(pending = record(pendingEpoch).request, pendingBase = root),
        ))

        val acceptedProgress = record(epochWithOwner(2, ownerA), ownerA, record(epochWithOwner(2, ownerA)).request)
        val withAcceptedProgress = requireNotNull(store.read())
        assertTrue(store.compareAndSetDurably(
            withAcceptedProgress,
            OrdinaryEpochState(
                accepted = acceptedProgress,
                pending = withAcceptedProgress.pending,
                rootAnchor = root,
                pendingBase = root,
                acceptedBase = root,
            ),
        )) // represents an earlier process version that advanced the floor but kept stale pending
        val api = Api().apply { head = acceptedProgress }
        val noResign = object : DskSignatureEngine {
            override fun signCanonicalDer(alias: String, message: ByteArray): ByteArray = error("must not re-sign")
        }
        val coordinator = OrdinaryTrustSetCoordinator(
            PersistentOrdinaryEpochStore(backing), api, noResign,
            OrdinaryEpochSignatureVerifier { _, _, _ -> true }, ownerA.deviceId, ownerA.keyId, "alias-owner-a",
        )

        assertEquals(0, coordinator.catchUp())

        val reconciled = requireNotNull(PersistentOrdinaryEpochStore(backing).read())
        assertEquals(acceptedProgress, reconciled.accepted)
        assertNull(reconciled.pending)
        assertNull(reconciled.pendingBase)
        assertTrue("the already-current server head must not receive the stale request", api.sent.isEmpty())
    }

    @Test fun `durable store rejects owner changes in accepted and pending ordinary records`() {
        val ownerA = OwnerFixture("owner", "dsk", "public-dsk")
        val ownerB = OwnerFixture("device-b", "dsk-b", "public-dsk-b")
        val backing = InMemoryPersistentStateStore()
        val store = PersistentOrdinaryEpochStore(backing)
        seedStore(store)
        val current = requireNotNull(store.read())
        val root = requireNotNull(current.rootAnchor)
        val transfer = epochWithOwner(2, ownerB, ownerA)
        val transferRecord = record(transfer, ownerA, record(transfer).request)

        assertFalse(store.compareAndSetDurably(current, current.copy(
            accepted = transferRecord,
            acceptedBase = root,
        )))
        assertFalse(store.compareAndSetDurably(current, current.copy(
            pending = transferRecord.request,
            pendingBase = root,
        )))
        assertEquals(current, store.read())
    }

    @Test fun `coordinator rejects a transferred accepted floor before network or signing`() = runBlocking {
        val ownerA = OwnerFixture("owner", "dsk", "public-dsk")
        val ownerB = OwnerFixture("device-b", "dsk-b", "public-dsk-b")
        val root = record(epoch(1))
        val transfer = epochWithOwner(2, ownerB, ownerA)
        val acceptedTransfer = record(transfer, ownerA, record(transfer).request)
        val store = MemoryStore(OrdinaryEpochState(
            accepted = acceptedTransfer,
            rootAnchor = root,
            acceptedBase = root,
        ))
        val api = Api().apply { head = acceptedTransfer }
        var signs = 0
        val signer = object : DskSignatureEngine {
            override fun signCanonicalDer(alias: String, message: ByteArray): ByteArray {
                signs++
                return ByteArray(64) { 1 }
            }
        }
        val coordinator = OrdinaryTrustSetCoordinator(store, api, signer,
            OrdinaryEpochSignatureVerifier { _, _, _ -> true }, ownerB.deviceId, ownerB.keyId, "alias-owner-b")

        assertFalse(coordinator.prepare(epochWithOwner(3, ownerB)))
        assertEquals(0, coordinator.catchUp())
        assertEquals(0, api.headReads)
        assertEquals(0, signs)
        assertEquals(acceptedTransfer, store.read()!!.accepted)
    }

    @Test fun `coordinator instances serialize before signing through shared durable store`() = runBlocking {
        val backing = InMemoryPersistentStateStore()
        val firstStore = PersistentOrdinaryEpochStore(backing)
        seedStore(firstStore)
        val root = firstStore.read()!!.accepted
        val secondStore = PersistentOrdinaryEpochStore(backing)
        val enteredHead = CompletableDeferred<Unit>()
        val releaseHead = CompletableDeferred<Unit>()
        var headReads = 0
        val api = object : OrdinaryTrustSetApi {
            override suspend fun submit(familyId: String, request: OrdinaryEpochRequest) = error("no submit expected")
            override suspend fun status(familyId: String, request: OrdinaryEpochRequest) = error("no status expected")
            override suspend fun getEpoch(familyId: String, trustSetEpoch: Int) = error("no history expected")
            override suspend fun getHead(familyId: String): AcceptedEpochRecord {
                headReads++
                enteredHead.complete(Unit)
                releaseHead.await()
                return root
            }
        }
        var signs = 0
        val signer = object : DskSignatureEngine {
            override fun signCanonicalDer(alias: String, message: ByteArray): ByteArray {
                signs++
                return ByteArray(64) { 1 }
            }
        }
        fun coordinator(store: OrdinaryEpochStore) = OrdinaryTrustSetCoordinator(store, api, signer,
            OrdinaryEpochSignatureVerifier { _, _, _ -> true }, "owner", "dsk", "alias")

        val firstResult = CompletableDeferred<Boolean>()
        val first = launch(start = CoroutineStart.UNDISPATCHED) {
            firstResult.complete(coordinator(firstStore).prepare(epoch(2)))
        }
        enteredHead.await()
        val secondResult = CompletableDeferred<Boolean>()
        val second = launch(start = CoroutineStart.UNDISPATCHED) {
            secondResult.complete(coordinator(secondStore).prepare(epoch(2)))
        }

        assertEquals("the second wrapper must wait before it reaches the server", 1, headReads)
        releaseHead.complete(Unit)
        first.join()
        second.join()

        assertTrue(firstResult.await())
        assertFalse(secondResult.await())
        assertEquals(1, signs)
        assertEquals(1, headReads)
        assertEquals(root, firstStore.read()!!.pendingBase)
        assertEquals(2, TrustSetEpochCodec.decodeCanonical(
            Base64.getDecoder().decode(firstStore.read()!!.pending!!.canonicalEpochBase64)).trustSetEpoch)
        assertNotNull(firstStore.read()!!.pending)
    }

    @Test fun `restart status miss replays exact durable request without signing again`() = runBlocking {
        val store = PersistentOrdinaryEpochStore(InMemoryPersistentStateStore())
        val pendingAccepted = record(epoch(2))
        installPending(store, pendingAccepted.request)
        val root = store.read()!!.accepted
        val submitRequests = mutableListOf<OrdinaryEpochRequest>()
        var failFirstSubmit = true
        val api = object : OrdinaryTrustSetApi {
            override suspend fun status(familyId: String, request: OrdinaryEpochRequest) =
                OrdinaryEpochResponse(OrdinaryEpochOutcome.NOT_ACCEPTED, null, root)
            override suspend fun submit(familyId: String, request: OrdinaryEpochRequest): OrdinaryEpochResponse {
                submitRequests += request
                if (failFirstSubmit) {
                    failFirstSubmit = false
                    throw java.io.IOException("submission outcome unknown")
                }
                val accepted = pendingAccepted.copy(request = request)
                return OrdinaryEpochResponse(OrdinaryEpochOutcome.ACCEPTED, accepted, accepted)
            }
            override suspend fun getEpoch(familyId: String, trustSetEpoch: Int) = error("no catch-up expected")
            override suspend fun getHead(familyId: String) = error("no prepare expected")
        }
        val noResign = object : DskSignatureEngine {
            override fun signCanonicalDer(alias: String, message: ByteArray): ByteArray = error("pending request must not be re-signed")
        }
        val coordinator = OrdinaryTrustSetCoordinator(store, api, noResign,
            OrdinaryEpochSignatureVerifier { _, _, _ -> true }, "owner", "dsk", "alias")

        assertFalse(coordinator.reconcile())
        assertEquals(pendingAccepted.request, store.read()!!.pending)
        assertTrue(coordinator.reconcile())

        assertEquals(listOf(pendingAccepted.request, pendingAccepted.request), submitRequests)
        assertEquals(pendingAccepted.request, store.read()!!.accepted.request)
        assertNull(store.read()!!.pending)
    }

    @Test fun `durable store cannot replace unresolved pending request`() {
        val store = PersistentOrdinaryEpochStore(InMemoryPersistentStateStore())
        seedStore(store)
        val initial = requireNotNull(store.read())
        val firstRequest = record(epoch(2)).request
        assertTrue(store.compareAndSetDurably(
            initial,
            initial.copy(pending = firstRequest, pendingBase = initial.accepted),
        ))
        val pendingState = requireNotNull(store.read())
        val replacementRequest = record(epoch(3)).request
        assertTrue(firstRequest != replacementRequest)

        assertFalse("unresolved exact bytes must be cleared before another request is prepared",
            store.compareAndSetDurably(
                pendingState,
                pendingState.copy(pending = replacementRequest, pendingBase = pendingState.accepted),
            ))
        assertEquals(pendingState, store.read())
    }

    @Test fun `durable store preserves exact pending signature bytes and confirms only the exact request`() {
        val backing = InMemoryPersistentStateStore()
        val store = PersistentOrdinaryEpochStore(backing)
        seedStore(store)
        val initial = requireNotNull(store.read())
        val originalRequest = record(epoch(2)).request
        assertTrue(store.compareAndSetDurably(
            initial,
            initial.copy(pending = originalRequest, pendingBase = initial.accepted),
        ))
        val pendingState = requireNotNull(store.read())
        val replacementSignature = Base64.getEncoder().encodeToString(ByteArray(64) { 2 })
        val replacementRequest = originalRequest.copy(signatureBase64 = replacementSignature)
        assertEquals(originalRequest.canonicalEpochBase64, replacementRequest.canonicalEpochBase64)
        assertNotEquals(originalRequest.signatureBase64, replacementRequest.signatureBase64)

        assertFalse("the same signed payload with a different signature cannot replace durable custody",
            store.compareAndSetDurably(
                pendingState,
                pendingState.copy(pending = replacementRequest),
            ))
        assertEquals(pendingState, store.read())
        assertTrue("confirmation succeeds only while the exact request is durable", store.confirmDurable(pendingState))

        val persisted = JSONObject(requireNotNull(backing.getString("ordinary_trust_set_v1")))
        persisted.getJSONObject("pending").put("signatureBase64", replacementSignature)
        backing.putString("ordinary_trust_set_v1", persisted.toString())
        assertFalse("a byte-different persisted signature cannot confirm the original request",
            store.confirmDurable(pendingState))
    }

    @Test fun `contradictory not accepted status cannot authorize a submit retry`() = runBlocking {
        val store = PersistentOrdinaryEpochStore(InMemoryPersistentStateStore())
        val pendingAccepted = record(epoch(2))
        installPending(store, pendingAccepted.request)
        val initial = store.read()!!
        val root = initial.accepted
        var submitCalls = 0
        val api = object : OrdinaryTrustSetApi {
            override suspend fun status(familyId: String, request: OrdinaryEpochRequest) =
                OrdinaryEpochResponse(OrdinaryEpochOutcome.NOT_ACCEPTED, pendingAccepted, root)
            override suspend fun submit(familyId: String, request: OrdinaryEpochRequest): OrdinaryEpochResponse {
                submitCalls++
                error("contradictory status must not trigger a submit")
            }
            override suspend fun getEpoch(familyId: String, trustSetEpoch: Int) = error("no catch-up expected")
            override suspend fun getHead(familyId: String) = error("no catch-up expected")
        }
        val noResign = object : DskSignatureEngine {
            override fun signCanonicalDer(alias: String, message: ByteArray) = error("pending request must not be re-signed")
        }
        val coordinator = OrdinaryTrustSetCoordinator(store, api, noResign,
            OrdinaryEpochSignatureVerifier { _, _, _ -> true }, "owner", "dsk", "alias")

        assertFalse(coordinator.reconcile())

        assertEquals(0, submitCalls)
        assertEquals(initial, store.read())
    }

    @Test fun `restart status miss with advanced head waits for verified catch up before replay`() = runBlocking {
        val store = PersistentOrdinaryEpochStore(InMemoryPersistentStateStore())
        val pending = record(epoch(2))
        installPending(store, pending.request)
        val root = store.read()!!.accepted
        val advancedHead = record(epoch(3))
        var submitCalls = 0
        val api = object : OrdinaryTrustSetApi {
            override suspend fun status(familyId: String, request: OrdinaryEpochRequest) =
                OrdinaryEpochResponse(OrdinaryEpochOutcome.NOT_ACCEPTED, null, advancedHead)
            override suspend fun submit(familyId: String, request: OrdinaryEpochRequest): OrdinaryEpochResponse {
                submitCalls++
                error("stale request must not submit before catch-up")
            }
            override suspend fun getEpoch(familyId: String, trustSetEpoch: Int) = error("no catch-up expected")
            override suspend fun getHead(familyId: String) = error("no prepare expected")
        }
        val noResign = object : DskSignatureEngine {
            override fun signCanonicalDer(alias: String, message: ByteArray): ByteArray = error("pending request must not be re-signed")
        }
        val coordinator = OrdinaryTrustSetCoordinator(store, api, noResign,
            OrdinaryEpochSignatureVerifier { _, _, _ -> true }, "owner", "dsk", "alias")

        assertFalse(coordinator.reconcile())

        assertEquals(0, submitCalls)
        assertEquals(pending.request, store.read()!!.pending)
        assertEquals(root, store.read()!!.accepted)
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
        api.records[2] = acceptedPending
        assertEquals(1, coordinator.catchUp(1))
        assertEquals(advancedHead, store.read()!!.accepted)
        assertNull(store.read()!!.pending)
    }
    @Test fun corruptCustodyCannotBecomeAnEmptyInstall() {
        val backing = InMemoryPersistentStateStore().apply { putString("ordinary_trust_set_v1", "bad") }
        try { PersistentOrdinaryEpochStore(backing).read(); fail() } catch (_: IllegalStateException) { }
    }
    @Test fun legacyPendingRequestFromAnotherFamilyIsCorruptCustodyBeforeContact() = runBlocking {
        val root = record(epoch(1))
        val foreignPending = record(epoch(2).copy(familyId = "other-family")).request
        val apiCalls = mutableListOf<String>()
        val api = object : OrdinaryTrustSetApi {
            override suspend fun submit(familyId: String, request: OrdinaryEpochRequest): OrdinaryEpochResponse {
                apiCalls += "submit"
                error("corrupt legacy custody must not submit")
            }
            override suspend fun status(familyId: String, request: OrdinaryEpochRequest): OrdinaryEpochResponse {
                apiCalls += "status"
                error("corrupt legacy custody must not query status")
            }
            override suspend fun getEpoch(familyId: String, trustSetEpoch: Int): AcceptedEpochRecord {
                apiCalls += "getEpoch"
                error("corrupt legacy custody must not fetch epochs")
            }
            override suspend fun getHead(familyId: String): AcceptedEpochRecord {
                apiCalls += "getHead"
                error("corrupt legacy custody must not fetch the head")
            }
        }
        val signer = object : DskSignatureEngine {
            override fun signCanonicalDer(alias: String, message: ByteArray) =
                error("corrupt legacy custody must not sign")
        }

        for (legacyStore in listOf(
            legacyV2Store(DiskBackedPersistentStateStore(), root, root, foreignPending),
            legacyV3Store(DiskBackedPersistentStateStore(), root, root, foreignPending),
        )) {
            try {
                legacyStore.read()
                fail("cross-family legacy pending request must be rejected as corrupt custody")
            } catch (failure: IllegalStateException) {
                assertEquals("corrupt_ordinary_trust_set_state", failure.message)
            }

            val coordinator = OrdinaryTrustSetCoordinator(legacyStore, api, signer,
                OrdinaryEpochSignatureVerifier { _, _, _ -> true }, "owner", "dsk", "alias")
            val contacts: List<suspend () -> Boolean> = listOf(
                { coordinator.submitExact() },
                { coordinator.reconcile() },
            )
            for (contact in contacts) {
                try {
                    contact()
                    fail("corrupt legacy custody must abort before contact")
                } catch (failure: IllegalStateException) {
                    assertEquals("corrupt_ordinary_trust_set_state", failure.message)
                }
            }
        }
        assertTrue("corrupt v2/v3 state must abort before every API method", apiCalls.isEmpty())
    }
    @Test fun persistedPendingRequestRejectsMalformedSignatureAndCanonicalBytesAsCorrupt() {
        fun corruptedStore(change: (JSONObject) -> Unit): PersistentOrdinaryEpochStore {
            val backing = DiskBackedPersistentStateStore()
            val store = PersistentOrdinaryEpochStore(backing)
            seedStore(store)
            val accepted = store.read()!!
            assertTrue(store.compareAndSetDurably(accepted,
                accepted.copy(pending = record(epoch(2)).request, pendingBase = accepted.accepted)))
            val raw = requireNotNull(backing.getString("ordinary_trust_set_v1"))
            val json = JSONObject(raw)
            change(json.getJSONObject("pending"))
            backing.putString("ordinary_trust_set_v1", json.toString())
            backing.flush()
            return PersistentOrdinaryEpochStore(backing.afterProcessDeath())
        }

        val malformedSignature = corruptedStore { pending -> pending.put("signatureBase64", "not-base64") }
        try {
            malformedSignature.read()
            fail("malformed pending signature must be rejected as corrupt custody")
        } catch (failure: IllegalStateException) {
            assertEquals("corrupt_ordinary_trust_set_state", failure.message)
        }

        val malformedCanonical = corruptedStore { pending ->
            pending.put("canonicalEpochBase64", Base64.getEncoder().encodeToString("not-canonical".toByteArray()))
        }
        try {
            malformedCanonical.read()
            fail("malformed pending canonical bytes must be rejected as corrupt custody")
        } catch (failure: IllegalStateException) {
            assertEquals("corrupt_ordinary_trust_set_state", failure.message)
        }
    }
    @Test fun persistedEpochStateRejectsDuplicateAndEscapeAliasedMembers() {
        val backing = DiskBackedPersistentStateStore()
        val store = PersistentOrdinaryEpochStore(backing)
        seedStore(store)
        val trusted = store.read()!!
        assertEquals(trusted, PersistentOrdinaryEpochStore(backing.afterProcessDeath()).read())

        val raw = requireNotNull(backing.getString("ordinary_trust_set_v1"))
        backing.putString("ordinary_trust_set_v1", raw.replace(
            "\"keyEpoch\":1",
            "\"keyEpoch\":1,\"key\\u0045poch\":1",
        ))
        backing.flush()

        try {
            PersistentOrdinaryEpochStore(backing.afterProcessDeath()).read()
            fail("duplicate persisted fields must not choose an accepted floor")
        } catch (failure: IllegalStateException) {
            assertEquals("corrupt_ordinary_trust_set_state", failure.message)
        }
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
        val api = Api().apply {
            response = OrdinaryEpochResponse(OrdinaryEpochOutcome.ACCEPTED, accepted, accepted)
            records[1] = store.read()!!.accepted
        }
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
    @Test fun oversizedOrdinaryCandidateBytesAreRejectedBeforeSigningOrPersistence() {
        val store = PersistentOrdinaryEpochStore(InMemoryPersistentStateStore())
        seedStore(store)
        val initial = store.read()!!
        var signs = 0
        val signer = object : DskSignatureEngine {
            override fun signCanonicalDer(alias: String, message: ByteArray): ByteArray {
                signs++
                return ByteArray(64) { 1 }
            }
        }

        // The server boundary is inclusive; this gate runs immediately before the signer in
        // prepare(), and failure leaves pending custody unchanged.
        assertEquals(64, signOrdinaryEpochRequestBytes(signer, "alias",
            ByteArray(OrdinaryEpochHttpRequestBounds.MAX_CANONICAL_BYTES)).size)
        assertEquals(1, signs)
        try {
            signOrdinaryEpochRequestBytes(signer, "alias",
                ByteArray(OrdinaryEpochHttpRequestBounds.MAX_CANONICAL_BYTES + 1))
            fail("oversized ordinary candidate must be rejected")
        } catch (_: IllegalArgumentException) { }

        assertEquals(1, signs)
        assertEquals(initial, store.read())
        assertNull(store.read()!!.pending)
    }
    @Test fun verifiedCatchUpPersistsFloorAndClearsOnlyExactPending() = runBlocking {
        val store = PersistentOrdinaryEpochStore(InMemoryPersistentStateStore())
        val accepted = record(epoch(2))
        installPending(store, accepted.request)
        val bootstrapAnchor = store.read()!!.rootAnchor
        val api = Api().apply {
            response = OrdinaryEpochResponse(OrdinaryEpochOutcome.ACCEPTED, accepted, accepted)
            records[1] = store.read()!!.accepted
        }
        val signer = object : DskSignatureEngine { override fun signCanonicalDer(alias: String, message: ByteArray): ByteArray = error("no resign") }
        val coordinator = OrdinaryTrustSetCoordinator(store, api, signer, OrdinaryEpochSignatureVerifier { _, _, _ -> true }, "owner", "dsk", "alias")
        assertEquals(1, coordinator.catchUp(1))
        assertEquals(2, store.read()!!.accepted.trustSetEpoch)
        assertEquals(bootstrapAnchor, store.read()!!.rootAnchor)
        assertNull(store.read()!!.pending)
    }
    @Test fun stalePendingIsRetiredBeforeRestartBetweenVerifiedCatchUpHops() = runBlocking {
        val backing = InMemoryPersistentStateStore()
        val durable = PersistentOrdinaryEpochStore(backing)
        val pending = record(epoch(3).copy(supersedesEpoch = 1))
        installPending(durable, pending.request)
        val root = durable.read()!!.accepted
        val first = record(epoch(2))
        val head = record(epoch(3))
        val api = Api().apply { this.head = head; records[1] = root; records[2] = first }
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
        assertNull(durable.read()!!.pending)
        assertNull(durable.read()!!.pendingBase)
        assertEquals(root, durable.read()!!.acceptedBase)

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
    @Test fun legacyPendingWithUnprovablePredecessorIsRetiredAfterCatchUpProgresses() = runBlocking {
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
        assertNull("unproven legacy custody is retired after verified accepted progress", store.read()!!.pending)
        assertNull(store.read()!!.pendingBase)
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
        val api = Api().apply {
            response = OrdinaryEpochResponse(OrdinaryEpochOutcome.ACCEPTED, competing, competing)
            records[1] = store.read()!!.accepted
        }
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
        val api = Api().apply {
            response = OrdinaryEpochResponse(OrdinaryEpochOutcome.ACCEPTED, skipped, skipped)
            records[1] = store.read()!!.accepted
        }
        val signer = object : DskSignatureEngine { override fun signCanonicalDer(alias: String, message: ByteArray): ByteArray = error("no resign") }
        val coordinator = OrdinaryTrustSetCoordinator(store, api, signer, OrdinaryEpochSignatureVerifier { _, _, _ -> true }, "owner", "dsk", "alias")
        assertEquals(1, coordinator.catchUp(1))
        assertEquals(5, store.read()!!.accepted.trustSetEpoch)
    }
    @Test fun `catch-up proves skipped epoch links back to the exact local floor`() = runBlocking {
        val store = PersistentOrdinaryEpochStore(InMemoryPersistentStateStore())
        seedStore(store)
        val third = record(epoch(3).copy(supersedesEpoch = 1))
        val eighth = record(epoch(8).copy(supersedesEpoch = 3))
        val api = Api().apply {
            records[3] = third
            records[1] = store.read()!!.accepted
            head = eighth
        }
        val noResign = object : DskSignatureEngine {
            override fun signCanonicalDer(alias: String, message: ByteArray): ByteArray = error("catch-up must not sign")
        }
        val coordinator = OrdinaryTrustSetCoordinator(store, api, noResign,
            OrdinaryEpochSignatureVerifier { _, _, _ -> true }, "owner", "dsk", "alias")

        assertEquals(2, coordinator.catchUp(maximumRecords = 2))

        assertEquals(eighth, store.read()!!.accepted)
        assertEquals(2, api.epochReads)
    }

    @Test fun `catch-up rejects a same-epoch server anchor that differs from local accepted state`() = runBlocking {
        val root = record(epoch(1))
        val localAnchor = record(epoch(2).copy(issuedAt = "2026-10-09T00:01:00.000Z"))
        val indexedServerAnchor = record(epoch(2))
        val serverHead = record(epoch(3).copy(supersedesEpoch = 2))
        val store = MemoryStore(OrdinaryEpochState(localAnchor, rootAnchor = root))
        val initial = store.read()
        val api = Api().apply {
            head = serverHead
            records[2] = indexedServerAnchor
        }
        val noResign = object : DskSignatureEngine {
            override fun signCanonicalDer(alias: String, message: ByteArray) = error("catch-up must not sign")
        }
        val coordinator = OrdinaryTrustSetCoordinator(store, api, noResign,
            OrdinaryEpochSignatureVerifier { _, _, _ -> true }, "owner", "dsk", "alias")

        try {
            coordinator.catchUp()
            fail("a different signed record at the local anchor epoch must not anchor catch-up")
        } catch (_: IllegalArgumentException) { }

        assertEquals(1, api.epochReads)
        assertEquals(initial, store.read())
    }

    @Test fun `catch-up beyond the bounded proof chain leaves accepted and pending custody unchanged`() = runBlocking {
        val store = PersistentOrdinaryEpochStore(InMemoryPersistentStateStore())
        val pending = record(epoch(2))
        installPending(store, pending.request)
        val original = store.read()!!
        val api = Api()
        val accepted = (2..34).associateWith { record(epoch(it)) }
        api.records.putAll(accepted)
        api.head = accepted.getValue(34)
        val noResign = object : DskSignatureEngine {
            override fun signCanonicalDer(alias: String, message: ByteArray): ByteArray = error("catch-up must not sign")
        }
        val coordinator = OrdinaryTrustSetCoordinator(store, api, noResign,
            OrdinaryEpochSignatureVerifier { _, _, _ -> true }, "owner", "dsk", "alias")

        assertEquals(0, coordinator.catchUp(maximumRecords = 32))
        assertEquals("an over-budget chain must not persist a partial suffix or clear pending", original, store.read())
        assertEquals(pending.request, store.read()!!.pending)
        assertTrue("the walk stops before fetching an over-budget proof hop", api.epochReads <= 31)
    }

    @Test fun `invalid hop inside the bounded proof chain cannot partially advance the floor`() = runBlocking {
        val store = PersistentOrdinaryEpochStore(InMemoryPersistentStateStore())
        seedStore(store)
        val initial = store.read()!!
        val api = Api()
        val accepted = (2..33).associateWith { record(epoch(it)) }
        api.records.putAll(accepted)
        api.records[1] = initial.accepted
        api.head = accepted.getValue(33)
        val noResign = object : DskSignatureEngine {
            override fun signCanonicalDer(alias: String, message: ByteArray): ByteArray = error("catch-up must not sign")
        }
        val coordinator = OrdinaryTrustSetCoordinator(store, api, noResign,
            OrdinaryEpochSignatureVerifier { _, bytes, _ ->
                TrustSetEpochCodec.decodeCanonical(bytes).trustSetEpoch != 20
            }, "owner", "dsk", "alias")

        try {
            coordinator.catchUp(maximumRecords = 32)
            fail("an invalid later hop must be rejected")
        } catch (_: IllegalArgumentException) { }

        assertEquals("the entire fetched proof chain is checked before any CAS", initial, store.read())
    }

    @Test fun nullLineageHeadCannotAdvanceFloorOrClearPendingCustody() = runBlocking {
        val store = PersistentOrdinaryEpochStore(InMemoryPersistentStateStore())
        val pending = record(epoch(2))
        installPending(store, pending.request)
        val initial = store.read()!!
        val head = record(epoch(5).copy(supersedesEpoch = null))
        val api = Api().apply { this.head = head }
        val noResign = object : DskSignatureEngine {
            override fun signCanonicalDer(alias: String, message: ByteArray) = error("catch-up must not sign")
        }

        try {
            OrdinaryTrustSetCoordinator(store, api, noResign,
                OrdinaryEpochSignatureVerifier { _, _, _ -> true }, "owner", "dsk", "alias").catchUp(1)
            fail("an ordinary head without a predecessor link must be rejected")
        } catch (_: IllegalArgumentException) { }

        assertEquals(initial, store.read())
        assertEquals(pending.request, store.read()!!.pending)
        assertEquals(0, api.epochReads)
    }

    @Test fun linkedHeadIsPersistedAndEqualHeadMustMatchExactly() = runBlocking {
        val backing = DiskBackedPersistentStateStore()
        val store = PersistentOrdinaryEpochStore(backing)
        seedStore(store)
        val root = store.read()!!.rootAnchor!!
        val head = record(epoch(5).copy(supersedesEpoch = 1))
        val rootBytes = Base64.getDecoder().decode(root.request.canonicalEpochBase64)
        val headBytes = Base64.getDecoder().decode(head.request.canonicalEpochBase64)
        val verifier = OrdinaryEpochSignatureVerifier { _, bytes, signature ->
            (bytes.contentEquals(rootBytes) && signature == root.request.signatureBase64) ||
                (bytes.contentEquals(headBytes) && signature == head.request.signatureBase64)
        }
        val api = Api().apply { this.head = head; records[1] = root }
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
    @Test fun olderLineagePointerBelowCurrentFloorCannotAdvanceOrClearPendingCustody() = runBlocking {
        val root = record(epoch(1))
        val acceptedFloor = record(epoch(3).copy(supersedesEpoch = 1))
        val serverHead = record(epoch(8).copy(supersedesEpoch = 2))
        val pending = record(epoch(4).copy(supersedesEpoch = 3))
        val initial = OrdinaryEpochState(acceptedFloor, pending.request, rootAnchor = root,
            pendingBase = acceptedFloor)
        val store = MemoryStore(initial)
        val api = Api().apply { head = serverHead }
        val noResign = object : DskSignatureEngine {
            override fun signCanonicalDer(alias: String, message: ByteArray) = error("catch-up must not sign")
        }

        assertEquals(0, OrdinaryTrustSetCoordinator(store, api, noResign,
            OrdinaryEpochSignatureVerifier { _, _, _ -> true }, "owner", "dsk", "alias").catchUp(1))
        assertEquals(initial, store.read())
        assertEquals(pending.request, store.read()!!.pending)
        assertEquals(0, api.records.size)
    }

    @Test fun missingReferencedPredecessorCannotPartiallyAdoptFetchedSuffix() = runBlocking {
        val store = PersistentOrdinaryEpochStore(InMemoryPersistentStateStore())
        val pending = record(epoch(2))
        installPending(store, pending.request)
        val initial = store.read()!!
        val third = record(epoch(3).copy(supersedesEpoch = 2))
        val head = record(epoch(8).copy(supersedesEpoch = 3))
        val api = Api().apply {
            records[3] = third
            this.head = head
            response = OrdinaryEpochResponse(OrdinaryEpochOutcome.ACCEPTED, head, head)
        }
        val noResign = object : DskSignatureEngine {
            override fun signCanonicalDer(alias: String, message: ByteArray) = error("catch-up must not sign")
        }

        try {
            OrdinaryTrustSetCoordinator(store, api, noResign,
                OrdinaryEpochSignatureVerifier { _, _, _ -> true }, "owner", "dsk", "alias").catchUp(4)
            fail("a missing epoch-2 predecessor must reject the whole chain")
        } catch (_: IllegalArgumentException) { }

        assertEquals(initial, store.read())
        assertEquals(pending.request, store.read()!!.pending)
        assertEquals(2, api.epochReads)
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
        val initial = store.read()!!

        try {
            coordinator(store).catchUp(1)
            fail("a null-lineage ordinary head must not be adopted")
        } catch (_: IllegalArgumentException) { }
        assertEquals(initial, store.read())
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

    @Test fun legacyV3UnprovablePendingIsRetiredAfterVerifiedProgressAndCurrentOwnerCanPrepare() = runBlocking {
        val root = record(epoch(1))
        val unprovablePending = record(epoch(5).copy(supersedesEpoch = null)).request
        val acceptedHop = record(epoch(2))
        val backing = DiskBackedPersistentStateStore()
        val store = legacyV3Store(backing, root, root, unprovablePending)
        val api = Api().apply {
            head = acceptedHop
            records[1] = root
        }
        var signs = 0
        val signer = object : DskSignatureEngine {
            override fun signCanonicalDer(alias: String, message: ByteArray): ByteArray {
                signs++
                return ByteArray(64) { 2 }
            }
        }
        val verifier = OrdinaryEpochSignatureVerifier { _, _, _ -> true }

        assertEquals(1, OrdinaryTrustSetCoordinator(store, api, signer, verifier,
            "owner", "dsk", "alias").catchUp())
        val afterCatchUp = store.read()!!
        assertEquals(acceptedHop, afterCatchUp.accepted)
        assertNull("unprovable legacy custody is retired only after accepted progress", afterCatchUp.pending)
        assertNull(afterCatchUp.pendingBase)
        assertTrue("retired legacy bytes are never sent", api.sent.isEmpty())

        val restarted = PersistentOrdinaryEpochStore(backing.afterProcessDeath())
        assertNull(restarted.read()!!.pending)
        assertTrue(OrdinaryTrustSetCoordinator(restarted, api, signer, verifier,
            "owner", "dsk", "alias").prepare(epoch(3)))
        val prepared = restarted.read()!!
        assertEquals(acceptedHop, prepared.pendingBase)
        assertEquals(1, signs)
        assertTrue("only the new request from the current accepted floor is held", prepared.pending != null)
        assertTrue("prepare does not submit the request", api.sent.isEmpty())
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
    @Test fun currentAcceptanceBoundaryRejectsOwnerTransferDuringCatchUp() = runBlocking {
        val store = PersistentOrdinaryEpochStore(InMemoryPersistentStateStore())
        seedStore(store)
        val validFirst = record(epoch(2))
        val nextOwner = epoch(3).entries.single().copy(deviceId = "second", dskKeyId = "second-dsk", dskPublicKey = "second-public",
            dekKeyId = "second-dek", dekPublicKey = "second-dek-public")
        val later = record(epoch(3).copy(entries = listOf(nextOwner))).copy(signerDeviceId = "second", signerKeyId = "second-dsk")
        val api = Api().apply {
            records[1] = store.read()!!.accepted
            records[2] = validFirst
            response = OrdinaryEpochResponse(OrdinaryEpochOutcome.ACCEPTED, later, later)
        }
        val keys = mutableListOf<String>()
        val signer = object : DskSignatureEngine { override fun signCanonicalDer(alias: String, message: ByteArray): ByteArray = error("no resign") }
        val coordinator = OrdinaryTrustSetCoordinator(store, api, signer, OrdinaryEpochSignatureVerifier { key, _, _ -> keys.add(key); true }, "owner", "dsk", "alias")
        try { coordinator.catchUp(2); fail() } catch (_: IllegalArgumentException) { }
        assertTrue(keys.isNotEmpty())
        assertTrue("root and floor checks must use the trusted owner's DSK", keys.all { it == "public-dsk" })
        assertEquals("the complete chain is validated before any durable hop", 1, store.read()!!.accepted.trustSetEpoch)
    }
}
