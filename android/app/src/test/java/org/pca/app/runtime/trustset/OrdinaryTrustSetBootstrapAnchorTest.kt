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
import org.pca.app.security.DskSignatureEngine

class OrdinaryTrustSetBootstrapAnchorTest {
    private val seed = FirstDeviceCeremonySeed(
        attemptId = "a".repeat(32), attemptRecoveryToken = "", serverBaseUrl = "https://example.test",
        deviceId = "device-1", signingKeyId = "dsk-id", encryptionKeyId = "dek-id",
        dskPublicKeyBase64 = "public-dsk", dekPublicKeyBase64 = "public-dek",
        dskAlias = "pca.dsk.${"a".repeat(32)}", dekAlias = "pca.dek.${"a".repeat(32)}",
    )
    private val rootSignatureBytes = ByteArray(64) { (it + 1).toByte() }
    private val rootSignatureUrl = Base64.getUrlEncoder().withoutPadding().encodeToString(rootSignatureBytes)

    private fun epoch(number: Int, familyId: String = "family") = UntrustedTrustSetEpoch(
        familyId, number, 1,
        listOf(UntrustedTrustSetEntry("device-1", TrustSetRole.OWNER, "dsk-id", "public-dsk",
            "dek-id", "public-dek", TrustSetMembershipStatus.ACTIVE)),
        "2026-10-09T00:00:00.000Z", if (number == 1) null else number - 1,
    )

    private fun rootRecord(
        familyId: String = "family",
        canonical: String = TrustSetEpochCodec.canonicalize(epoch(1, familyId)),
        signature: String = rootSignatureUrl,
        includeAnchor: Boolean = true,
    ) = FirstDeviceRootRecord(
        seed = seed,
        state = FirstDeviceRootState.ROOT_COMMITTED,
        familyId = familyId,
        committedAtMillis = 123L,
        acceptedEpoch1 = if (includeAnchor) FirstDeviceAcceptedEpochAnchor(canonical, signature) else null,
    )

    private class NoNetworkApi : OrdinaryTrustSetApi {
        override suspend fun submit(familyId: String, request: OrdinaryEpochRequest): OrdinaryEpochResponse = error("no network expected")
        override suspend fun status(familyId: String, request: OrdinaryEpochRequest): OrdinaryEpochResponse = error("no network expected")
        override suspend fun getEpoch(familyId: String, trustSetEpoch: Int): AcceptedEpochRecord = error("no network expected")
        override suspend fun getHead(familyId: String): AcceptedEpochRecord = error("no network expected")
    }

    private fun rootStore(record: FirstDeviceRootRecord = rootRecord()) = InMemoryFirstDeviceRootStore().apply { save(record) }
    private fun ordinaryStore() = PersistentOrdinaryEpochStore(InMemoryPersistentStateStore())

    @Test
    fun `verified durable epoch one statement initializes ordinary store and immutable root floor`() {
        val rootStore = rootStore()
        val backing = InMemoryPersistentStateStore()
        val ordinaryStore = PersistentOrdinaryEpochStore(backing)
        var verifiedBytes: ByteArray? = null
        var verifiedSignature: String? = null
        val verifier = OrdinaryEpochSignatureVerifier { publicKey, bytes, signature ->
            assertEquals(seed.dskPublicKeyBase64, publicKey)
            verifiedBytes = bytes.copyOf()
            verifiedSignature = signature
            signature == Base64.getEncoder().encodeToString(rootSignatureBytes)
        }

        val accepted = OrdinaryTrustSetBootstrapAnchor.seed(rootStore, ordinaryStore, verifier)
        val state = ordinaryStore.read()!!
        val reopened = PersistentOrdinaryEpochStore(backing).read()
        assertEquals(1, accepted.trustSetEpoch)
        assertEquals(1, accepted.keyEpoch)
        assertEquals(accepted, state.accepted)
        assertEquals(accepted, state.rootAnchor)
        assertNull(state.pending)
        assertEquals("version-2 accepted epoch and immutable root anchor survive reconstruction",
            state, reopened)
        assertArrayEquals(TrustSetEpochCodec.canonicalize(epoch(1)).toByteArray(), verifiedBytes)
        assertEquals(Base64.getEncoder().encodeToString(rootSignatureBytes), verifiedSignature)
        val replacedAnchor = accepted.copy(request = accepted.request.copy(
            signatureBase64 = Base64.getEncoder().encodeToString(ByteArray(64) { 8 }),
        ))
        assertFalse(ordinaryStore.compareAndSetDurably(state, state.copy(rootAnchor = replacedAnchor)))
        assertEquals(state, ordinaryStore.read())
        assertEquals(accepted, OrdinaryTrustSetBootstrapAnchor.seed(rootStore, ordinaryStore, verifier))

        var signs = 0
        val signer = object : DskSignatureEngine {
            override fun signCanonicalDer(alias: String, message: ByteArray): ByteArray {
                signs++
                assertEquals(seed.dskAlias, alias)
                return ByteArray(64) { 7 }
            }
        }
        val coordinator = OrdinaryTrustSetCoordinator(
            ordinaryStore, NoNetworkApi(), signer, OrdinaryEpochSignatureVerifier { _, _, _ -> true },
            seed.deviceId, seed.signingKeyId, seed.dskAlias,
        )
        assertTrue(runBlocking { coordinator.prepare(epoch(2)) })
        assertEquals(1, signs)
        assertEquals(1, ordinaryStore.read()!!.accepted.trustSetEpoch)
        assertEquals(accepted, ordinaryStore.read()!!.rootAnchor)
        assertEquals(2, TrustSetEpochCodec.decodeCanonical(
            Base64.getDecoder().decode(ordinaryStore.read()!!.pending!!.canonicalEpochBase64),
        ).trustSetEpoch)
    }

    @Test
    fun `tampered signature fails verification and leaves ordinary custody empty`() {
        val rootStore = rootStore(rootRecord(signature = Base64.getUrlEncoder().withoutPadding()
            .encodeToString(ByteArray(64) { 99 })))
        val ordinaryStore = ordinaryStore()
        var calls = 0
        try {
            OrdinaryTrustSetBootstrapAnchor.seed(rootStore, ordinaryStore, OrdinaryEpochSignatureVerifier { _, _, _ ->
                calls++
                false
            })
            fail("tampered root signature must fail")
        } catch (_: IllegalArgumentException) { }
        assertEquals(1, calls)
        assertNull(ordinaryStore.read())
    }

    @Test
    fun `family mismatch and legacy committed record without anchor cannot seed`() {
        val ordinaryStore = ordinaryStore()
        try {
            OrdinaryTrustSetBootstrapAnchor.seed(rootStore(rootRecord(
                canonical = TrustSetEpochCodec.canonicalize(epoch(1, "other")),
            )), ordinaryStore,
                OrdinaryEpochSignatureVerifier { _, _, _ -> true })
            fail("family mismatch must fail")
        } catch (_: IllegalArgumentException) { }
        assertNull(ordinaryStore.read())

        val wrongDeviceSeed = seed.copy(deviceId = "different-device")
        try {
            OrdinaryTrustSetBootstrapAnchor.seed(rootStore(rootRecord().copy(seed = wrongDeviceSeed)), ordinaryStore,
                OrdinaryEpochSignatureVerifier { _, _, _ -> true })
            fail("root statement identity mismatch must fail")
        } catch (_: IllegalArgumentException) { }
        assertNull(ordinaryStore.read())

        try {
            OrdinaryTrustSetBootstrapAnchor.seed(rootStore(rootRecord(includeAnchor = false)), ordinaryStore,
                OrdinaryEpochSignatureVerifier { _, _, _ -> true })
            fail("legacy committed record has no trusted bootstrap anchor")
        } catch (_: IllegalStateException) { }
        assertNull(ordinaryStore.read())
    }

    @Test
    fun `a preexisting ordinary floor without matching durable root anchor cannot be adopted`() {
        val backing = InMemoryPersistentStateStore()
        val ordinaryStore = PersistentOrdinaryEpochStore(backing)
        val epoch = epoch(1)
        val request = OrdinaryEpochRequest(
            Base64.getEncoder().encodeToString(TrustSetEpochCodec.canonicalize(epoch).toByteArray()),
            Base64.getEncoder().encodeToString(ByteArray(64) { 3 }),
        )
        val unanchored = AcceptedEpochRecord(request, seed.deviceId, seed.signingKeyId, 1, 1)
        backing.putString("ordinary_trust_set_v1", JSONObject()
            .put("version", 1)
            .put("accepted", JSONObject()
                .put("canonicalEpochBase64", request.canonicalEpochBase64)
                .put("signatureBase64", request.signatureBase64)
                .put("signerDeviceId", unanchored.signerDeviceId)
                .put("signerKeyId", unanchored.signerKeyId)
                .put("trustSetEpoch", unanchored.trustSetEpoch)
                .put("keyEpoch", unanchored.keyEpoch))
            .put("pending", JSONObject.NULL)
            .toString())
        assertNotNull(ordinaryStore.read())
        var signed = false
        val signer = object : DskSignatureEngine {
            override fun signCanonicalDer(alias: String, message: ByteArray): ByteArray {
                signed = true
                return ByteArray(64)
            }
        }
        val coordinator = OrdinaryTrustSetCoordinator(ordinaryStore, NoNetworkApi(), signer,
            OrdinaryEpochSignatureVerifier { _, _, _ -> true }, seed.deviceId, seed.signingKeyId, seed.dskAlias)
        assertFalse(runBlocking { coordinator.prepare(epoch(2)) })
        assertFalse(signed)

        try {
            OrdinaryTrustSetBootstrapAnchor.seed(rootStore(), ordinaryStore, OrdinaryEpochSignatureVerifier { _, _, _ -> true })
            fail("unanchored legacy state must not acquire a root retroactively")
        } catch (_: IllegalArgumentException) { }
        assertNull(ordinaryStore.read()!!.rootAnchor)
    }

    @Test
    fun `persistent ordinary store refuses arbitrary first write without verified root bootstrap`() {
        val store = ordinaryStore()
        assertFalse(store.compareAndSetDurably(null, OrdinaryEpochState(
            AcceptedEpochRecord(
                OrdinaryEpochRequest(
                    Base64.getEncoder().encodeToString(TrustSetEpochCodec.canonicalize(epoch(1)).toByteArray()),
                    Base64.getEncoder().encodeToString(ByteArray(64) { 5 }),
                ),
                seed.deviceId, seed.signingKeyId, 1, 1,
            ),
        )))
        assertNull(store.read())
    }
}
