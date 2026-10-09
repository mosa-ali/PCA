package org.pca.app.runtime.trustset

import java.io.IOException
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

class OrdinaryTrustSetRuntimeTest {
    private fun epoch(number: Int) = UntrustedTrustSetEpoch("family", number, 1, listOf(UntrustedTrustSetEntry(
        "owner", TrustSetRole.OWNER, "dsk", "public-dsk", "dek", "public-dek", TrustSetMembershipStatus.ACTIVE)),
        "2026-10-09T00:00:00.000Z", if (number == 1) null else number - 1)

    private fun accepted(epoch: UntrustedTrustSetEpoch) = AcceptedEpochRecord(OrdinaryEpochRequest(
        Base64.getEncoder().encodeToString(TrustSetEpochCodec.canonicalize(epoch).toByteArray()),
        Base64.getEncoder().encodeToString(ByteArray(64) { epoch.trustSetEpoch.toByte() })),
        "owner", "dsk", epoch.trustSetEpoch, epoch.keyEpoch)

    private fun committedRootStore(): InMemoryFirstDeviceRootStore {
        val root = accepted(epoch(1))
        val seed = FirstDeviceCeremonySeed("a".repeat(32), "", "https://api.example.test", "owner", "dsk", "dek",
            "public-dsk", "public-dek", "pca.dsk." + "a".repeat(32), "pca.dek." + "a".repeat(32))
        val rootBytes = String(Base64.getDecoder().decode(root.request.canonicalEpochBase64), Charsets.UTF_8)
        val signatureUrl = Base64.getUrlEncoder().withoutPadding().encodeToString(ByteArray(64) { 1 })
        return InMemoryFirstDeviceRootStore().apply {
            save(FirstDeviceRootRecord(seed, FirstDeviceRootState.ROOT_COMMITTED, familyId = "family",
                committedAtMillis = 1, acceptedEpoch1 = FirstDeviceAcceptedEpochAnchor(rootBytes, signatureUrl)))
        }
    }

    private class Api : OrdinaryTrustSetApi {
        var submitFailure = false
        var statusResponse: OrdinaryEpochResponse? = null
        var head: AcceptedEpochRecord? = null
        val records = mutableMapOf<Int, AcceptedEpochRecord>()
        var submitCalls = 0
        var statusCalls = 0
        var headCalls = 0
        override suspend fun submit(familyId: String, request: OrdinaryEpochRequest): OrdinaryEpochResponse {
            submitCalls++
            if (submitFailure) throw IOException("response lost")
            return error("unexpected submit response")
        }
        override suspend fun status(familyId: String, request: OrdinaryEpochRequest): OrdinaryEpochResponse {
            statusCalls++
            return statusResponse ?: error("status response missing")
        }
        override suspend fun getEpoch(familyId: String, trustSetEpoch: Int) = records[trustSetEpoch]
            ?: error("epoch record missing")
        override suspend fun getHead(familyId: String): AcceptedEpochRecord {
            headCalls++
            return head ?: error("head missing")
        }
    }

    @Test fun `runtime retries a durable request then catches up a newer authenticated head`() = runBlocking {
        val roots = committedRootStore()
        val backing = InMemoryPersistentStateStore()
        val store = PersistentOrdinaryEpochStore(backing)
        val api = Api().apply { submitFailure = true; head = accepted(epoch(1)) }
        var signs = 0
        val signer = object : DskSignatureEngine {
            override fun signCanonicalDer(alias: String, message: ByteArray): ByteArray {
                signs++
                return ByteArray(64) { signs.toByte() }
            }
        }
        fun runtime() = OrdinaryTrustSetRuntime.create(roots, store, api, signer,
            OrdinaryEpochSignatureVerifier { _, _, _ -> true })

        assertFalse(runtime().prepareAndSubmit(epoch(2)))
        val pending = store.read()!!.pending
        assertNotNull(pending)
        assertEquals(1, signs)
        assertEquals(1, api.submitCalls)

        val acceptedPending = accepted(epoch(2)).copy(request = pending!!)
        val newerHead = accepted(epoch(3))
        api.submitFailure = false
        api.statusResponse = OrdinaryEpochResponse(OrdinaryEpochOutcome.ACCEPTED, acceptedPending, newerHead)
        api.head = newerHead
        api.head = newerHead
        api.records[2] = acceptedPending

        assertTrue(runtime().reconcile())
        assertEquals(1, api.statusCalls)
        assertEquals(2, api.headCalls) // pre-sign accepted-floor check plus post-retry catch-up
        assertEquals(1, signs)
        assertEquals(newerHead, store.read()!!.accepted)
        assertNull(store.read()!!.pending)
        assertEquals(FirstDeviceRootState.ROOT_COMMITTED, roots.current()!!.state)
    }

    @Test fun `runtime refuses missing committed root before transport`() = runBlocking {
        val roots = InMemoryFirstDeviceRootStore()
        val api = Api()
        val store = PersistentOrdinaryEpochStore(InMemoryPersistentStateStore())
        val signer = object : DskSignatureEngine {
            override fun signCanonicalDer(alias: String, message: ByteArray): ByteArray = error("must not sign")
        }
        try {
            OrdinaryTrustSetRuntime.create(roots, store, api, signer,
                OrdinaryEpochSignatureVerifier { _, _, _ -> true })
            fail("runtime created without committed root")
        } catch (_: IllegalStateException) { }
        assertEquals(0, api.submitCalls)
        assertEquals(0, api.statusCalls)
        assertEquals(0, api.headCalls)
        assertNull(store.read())
    }
}
