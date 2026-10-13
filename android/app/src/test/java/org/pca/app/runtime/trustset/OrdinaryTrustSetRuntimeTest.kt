package org.pca.app.runtime.trustset

import java.io.IOException
import java.util.Base64
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.launch
import org.junit.Assert.*
import org.junit.Test
import org.pca.app.firstdevice.FirstDeviceAcceptedEpochAnchor
import org.pca.app.firstdevice.FirstDeviceCeremonySeed
import org.pca.app.firstdevice.FirstDeviceRootRecord
import org.pca.app.firstdevice.FirstDeviceRootState
import org.pca.app.firstdevice.InMemoryFirstDeviceRootStore
import org.pca.app.firstdevice.FirstDeviceRootStore
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
        var submitResponse: OrdinaryEpochResponse? = null
        var head: AcceptedEpochRecord? = null
        val records = mutableMapOf<Int, AcceptedEpochRecord>()
        val submittedRequests = mutableListOf<OrdinaryEpochRequest>()
        var submitCalls = 0
        var statusCalls = 0
        var headCalls = 0
        var beforeHeadResponse: (suspend () -> Unit)? = null
        var beforeStatusResponse: (suspend () -> Unit)? = null
        var beforeSubmitResponse: (suspend () -> Unit)? = null
        override suspend fun submit(familyId: String, request: OrdinaryEpochRequest): OrdinaryEpochResponse {
            submitCalls++
            submittedRequests += request
            if (submitFailure) throw IOException("response lost")
            beforeSubmitResponse?.invoke()
            return submitResponse ?: error("unexpected submit response")
        }
        override suspend fun status(familyId: String, request: OrdinaryEpochRequest): OrdinaryEpochResponse {
            statusCalls++
            beforeStatusResponse?.invoke()
            return statusResponse ?: error("status response missing")
        }
        override suspend fun getEpoch(familyId: String, trustSetEpoch: Int) = records[trustSetEpoch]
            ?: error("epoch record missing")
        override suspend fun getHead(familyId: String): AcceptedEpochRecord {
            headCalls++
            beforeHeadResponse?.invoke()
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
        assertTrue("unresolved exact request remains visible to the graph retry decision", runtime().hasPendingRequest())
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
        assertFalse(runtime().hasPendingRequest())
        assertEquals(FirstDeviceRootState.ROOT_COMMITTED, roots.current()!!.state)
    }

    @Test fun `runtime status miss replays the exact durable request after restart without signing again`() = runBlocking {
        val roots = committedRootStore()
        val store = PersistentOrdinaryEpochStore(InMemoryPersistentStateStore())
        val acceptedRoot = accepted(epoch(1))
        val api = Api().apply { submitFailure = true; head = acceptedRoot }
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
        val persistedRequest = requireNotNull(store.read()!!.pending)
        assertEquals(1, signs)
        assertEquals(listOf(persistedRequest), api.submittedRequests)

        val acceptedRequest = accepted(epoch(2)).copy(request = persistedRequest)
        api.submitFailure = false
        api.statusResponse = OrdinaryEpochResponse(OrdinaryEpochOutcome.NOT_ACCEPTED, null, acceptedRoot)
        api.submitResponse = OrdinaryEpochResponse(OrdinaryEpochOutcome.ACCEPTED, acceptedRequest, acceptedRequest)
        api.head = acceptedRequest

        assertTrue(runtime().reconcile())

        assertEquals(1, api.statusCalls)
        assertEquals(listOf(persistedRequest, persistedRequest), api.submittedRequests)
        assertEquals(1, signs)
        assertEquals(acceptedRequest, store.read()!!.accepted)
        assertNull(store.read()!!.pending)
    }

    @Test fun `root replacement during pre-sign head lookup prevents signing and pending custody`() = runBlocking {
        val roots = committedRootStore()
        val original = roots.current()!!
        val store = PersistentOrdinaryEpochStore(InMemoryPersistentStateStore())
        val entered = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        val api = Api().apply {
            head = accepted(epoch(1))
            beforeHeadResponse = { entered.complete(Unit); release.await() }
        }
        var signs = 0
        val signer = object : DskSignatureEngine {
            override fun signCanonicalDer(alias: String, message: ByteArray): ByteArray {
                signs++; return ByteArray(64)
            }
        }
        val runtime = OrdinaryTrustSetRuntime.create(roots, store, api, signer,
            OrdinaryEpochSignatureVerifier { _, _, _ -> true })
        val before = store.read()
        val operation = launch {
            assertFalse(runtime.prepareAndSubmit(epoch(2)))
        }
        entered.await()
        roots.save(original.copy(committedAtMillis = 2))
        release.complete(Unit)
        operation.join()
        assertEquals(0, signs)
        assertEquals(0, api.submitCalls)
        assertEquals(before, store.read())
    }

    @Test fun `root replacement during status or submit preserves exact pending custody and floor`() = runBlocking {
        for (boundary in listOf("status-miss", "status-accepted", "submit")) {
            val roots = committedRootStore()
            val original = roots.current()!!
            val store = PersistentOrdinaryEpochStore(InMemoryPersistentStateStore())
            val api = Api().apply { head = accepted(epoch(1)); submitFailure = true }
            var signs = 0
            val signer = object : DskSignatureEngine {
                override fun signCanonicalDer(alias: String, message: ByteArray): ByteArray {
                    signs++; return ByteArray(64)
                }
            }
            val runtime = OrdinaryTrustSetRuntime.create(roots, store, api, signer,
                OrdinaryEpochSignatureVerifier { _, _, _ -> true })
            assertFalse(runtime.prepareAndSubmit(epoch(2)))
            val before = store.read()!!
            val acceptedPending = accepted(epoch(2)).copy(request = before.pending!!)
            api.submitFailure = false
            api.submitResponse = OrdinaryEpochResponse(OrdinaryEpochOutcome.ACCEPTED, acceptedPending, acceptedPending)
            api.statusResponse = if (boundary == "status-accepted") api.submitResponse else
                OrdinaryEpochResponse(OrdinaryEpochOutcome.NOT_ACCEPTED, null, before.accepted)
            val entered = CompletableDeferred<Unit>()
            val release = CompletableDeferred<Unit>()
            val barrier: suspend () -> Unit = { entered.complete(Unit); release.await() }
            if (boundary == "submit") api.beforeSubmitResponse = barrier else api.beforeStatusResponse = barrier
            val operation = launch {
                try { runtime.reconcile(); fail("changed root must reject operation") }
                catch (_: IllegalStateException) { }
            }
            entered.await()
            roots.save(original.copy(committedAtMillis = 2))
            release.complete(Unit)
            operation.join()
            assertEquals(before, store.read())
            assertEquals(1, signs)
            assertEquals(if (boundary == "submit") 2 else 1, api.submitCalls)
            assertEquals(original.copy(committedAtMillis = 2), roots.current())
        }
    }

    @Test fun `root replacement during signing cannot persist or submit stale signature`() = runBlocking {
        val roots = committedRootStore()
        val original = roots.current()!!
        val store = PersistentOrdinaryEpochStore(InMemoryPersistentStateStore())
        val api = Api().apply { head = accepted(epoch(1)) }
        var signs = 0
        val signer = object : DskSignatureEngine {
            override fun signCanonicalDer(alias: String, message: ByteArray): ByteArray {
                signs++
                roots.save(original.copy(committedAtMillis = 2))
                return ByteArray(64)
            }
        }
        val runtime = OrdinaryTrustSetRuntime.create(roots, store, api, signer,
            OrdinaryEpochSignatureVerifier { _, _, _ -> true })
        val before = store.read()
        try { runtime.prepareAndSubmit(epoch(2)); fail("changed root must reject signature") }
        catch (_: IllegalStateException) { }
        assertEquals(1, signs)
        assertEquals(0, api.submitCalls)
        assertEquals(before, store.read())
    }

    @Test fun `root replacement immediately before durable CAS preserves pending and accepted floor`() = runBlocking {
        for (adoption in listOf(false, true)) {
            val backingRoots = committedRootStore()
            val original = backingRoots.current()!!
            var replaceBeforeCas = false
            val roots = object : FirstDeviceRootStore by backingRoots {
                override fun compareAndRunIfCurrent(expected: FirstDeviceRootRecord, action: () -> Boolean): Boolean {
                    if (replaceBeforeCas) backingRoots.save(original.copy(committedAtMillis = 2))
                    return backingRoots.compareAndRunIfCurrent(expected, action)
                }
            }
            val store = PersistentOrdinaryEpochStore(InMemoryPersistentStateStore())
            val api = Api().apply { head = accepted(epoch(1)); submitFailure = true }
            val signer = object : DskSignatureEngine {
                override fun signCanonicalDer(alias: String, message: ByteArray) = ByteArray(64)
            }
            val runtime = OrdinaryTrustSetRuntime.create(roots, store, api, signer,
                OrdinaryEpochSignatureVerifier { _, _, _ -> true })
            if (adoption) {
                assertFalse(runtime.prepareAndSubmit(epoch(2)))
                val pending = store.read()!!.pending!!
                val acceptedPending = accepted(epoch(2)).copy(request = pending)
                api.statusResponse = OrdinaryEpochResponse(OrdinaryEpochOutcome.ACCEPTED, acceptedPending, acceptedPending)
                api.head = acceptedPending
            }
            val before = store.read()
            replaceBeforeCas = true
            try {
                val result = if (adoption) runtime.reconcile() else runtime.prepareAndSubmit(epoch(2))
                assertFalse(result)
            } catch (_: IllegalStateException) { }
            assertEquals(before, store.read())
            assertEquals(if (adoption) 1 else 0, api.submitCalls)
            assertEquals(original.copy(committedAtMillis = 2), roots.current())
        }
    }

    @Test fun `root replacement before bootstrap seed admission leaves ordinary custody absent`() {
        val backingRoots = committedRootStore()
        val original = backingRoots.current()!!
        val roots = object : FirstDeviceRootStore by backingRoots {
            override fun compareAndRunIfCurrent(expected: FirstDeviceRootRecord, action: () -> Boolean): Boolean {
                backingRoots.save(original.copy(committedAtMillis = 2))
                return backingRoots.compareAndRunIfCurrent(expected, action)
            }
        }
        val store = PersistentOrdinaryEpochStore(InMemoryPersistentStateStore())
        val signer = object : DskSignatureEngine {
            override fun signCanonicalDer(alias: String, message: ByteArray): ByteArray = error("must not sign")
        }
        assertThrows(IllegalStateException::class.java) {
            OrdinaryTrustSetRuntime.create(roots, store, Api(), signer,
                OrdinaryEpochSignatureVerifier { _, _, _ -> true })
        }
        assertNull(store.read())
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
