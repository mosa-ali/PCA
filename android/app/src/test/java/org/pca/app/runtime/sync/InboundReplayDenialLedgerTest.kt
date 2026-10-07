package org.pca.app.runtime.sync

import org.junit.Assert.*
import org.junit.Test
import org.pca.app.foundation.PersistentStateStore
import org.pca.app.runtime.sync.envelope.*
import org.pca.app.runtime.sync.inbox.*

class InboundReplayDenialLedgerTest {
    private class Backing : PersistentStateStore {
        val cache = mutableMapOf<String, String>()
        val disk = mutableMapOf<String, String>()
        var failFlush = false
        var ignoreWrites = false
        override fun getString(key: String) = cache[key]
        override fun putString(key: String, value: String) { if (!ignoreWrites) cache[key] = value }
        override fun remove(key: String) { cache.remove(key) }
        override fun contains(key: String) = cache.containsKey(key)
        override fun clear() { cache.clear() }
        override fun flush() { check(!failFlush); disk.clear(); disk.putAll(cache) }
        fun restart() = Backing().also { it.cache.putAll(disk); it.disk.putAll(disk) }
    }
    private val scope = RuntimeInboxScope("family-1", "device-1")
    private fun envelope(id: String = "one", nonce: String = "1", sender: String = "key-1", trust: Long = 1, key: Long = 1) =
        FamilyEnvelope(1, 0, id, "family-1", "sender-1", RecipientBinding.Device("device-1"), sender,
            "STATUS_SNAPSHOT", trust, key, nonce, 1000, 60000, "1.0.0", null, byteArrayOf(1), "signature-1")
    private fun boundary(trust: Long = 0, key: Long = 0, prefixes: Map<String, Long> = emptyMap(), binding: String = "AQ==") =
        InboundReplayRetirementBoundary(scope, binding, trust, key, prefixes)
    private fun unavailable(block: () -> Unit) {
        try { block(); fail("Expected replay denial failure") } catch (_: InboundReplayDenialUnavailable) { }
    }
    private fun initialized(store: Backing) = PersistentInboundReplayDenialLedger(store, "device-1").also { it.initializeFresh {} }

    @Test fun `missing ledger is unavailable and explicit initialization cannot erase prior denial`() {
        val store = Backing()
        val ledger = PersistentInboundReplayDenialLedger(store, "device-1")
        unavailable { ledger.isEnvelopeDenied(envelope(), scope) }
        ledger.initializeFresh {}
        ledger.install(boundary(prefixes = mapOf("key-1" to 2))) {}
        unavailable { ledger.initializeFresh {} }
        assertTrue(ledger.isEnvelopeDenied(envelope(), scope))
        store.remove(store.cache.keys.single { !it.endsWith(".required") })
        unavailable { ledger.isEnvelopeDenied(envelope(), scope) }
        unavailable { ledger.initializeFresh {} }
    }

    @Test fun `trusted numeric prefix denies alternate message IDs and message types`() {
        val store = Backing()
        val ledger = initialized(store)
        ledger.install(boundary(prefixes = mapOf("key-1" to 2))) {}
        assertTrue(ledger.isEnvelopeDenied(envelope(), scope))
        assertTrue(ledger.isEnvelopeDenied(envelope(id = "alias").copy(messageType = "POLICY_UPDATE"), scope))
        assertFalse(ledger.isEnvelopeDenied(envelope(nonce = "3"), scope))
        assertFalse(ledger.isEnvelopeDenied(envelope(sender = "other-key"), scope))
        val restored = PersistentInboundReplayDenialLedger(store.restart(), "device-1")
        assertTrue(restored.isEnvelopeDenied(envelope(id = "restart-alias"), scope))
    }

    @Test fun `numeric looking opaque nonce remains uncompressed without authenticated mode`() {
        val ledger = initialized(Backing())
        ledger.install(boundary()) {}
        assertFalse(ledger.isEnvelopeDenied(envelope(nonce = "0"), scope))
        assertFalse(ledger.isEnvelopeDenied(envelope(nonce = "01"), scope))
        assertFalse(ledger.isEnvelopeDenied(envelope(nonce = "opaque"), scope))
        ledger.install(boundary(prefixes = mapOf("key-1" to 2))) {}
        assertTrue(ledger.isEnvelopeDenied(envelope(nonce = "01"), scope))
        assertTrue(ledger.isEnvelopeDenied(envelope(nonce = "opaque"), scope))
    }

    @Test fun `epoch floors reject either stale dimension and are independent of envelope time`() {
        val ledger = initialized(Backing())
        ledger.install(boundary(trust = 2, key = 3)) {}
        assertTrue(ledger.isEnvelopeDenied(envelope(trust = 1, key = 3), scope))
        assertTrue(ledger.isEnvelopeDenied(envelope(trust = 2, key = 2), scope))
        assertFalse(ledger.isEnvelopeDenied(envelope(trust = 2, key = 3), scope))
        assertTrue(ledger.isEnvelopeDenied(envelope(trust = 1, key = 3).copy(issuedAtEpochMillis = 0, expiresAtEpochMillis = Long.MAX_VALUE), scope))
    }

    @Test fun `epoch rejection cannot authorize sender nonce reclamation across fresh epoch aliases`() {
        val ledger = initialized(Backing())
        ledger.install(boundary(trust = 2, key = 2)) {}
        val old = envelope(trust = 1, key = 1)
        val alias = envelope(id = "new-message", trust = 2, key = 2)
        assertTrue(ledger.isEnvelopeDenied(old, scope))
        assertFalse(ledger.isEnvelopeDenied(alias, scope))
        assertFalse(ledger.coversReplayIdentityPermanently(old, scope))
        assertFalse(ledger.coversReplayIdentityPermanently(alias, scope))
        ledger.install(boundary(trust = 2, key = 2, prefixes = mapOf("key-1" to 2))) {}
        assertTrue(ledger.coversReplayIdentityPermanently(old, scope))
        assertTrue(ledger.coversReplayIdentityPermanently(alias, scope))
    }

    @Test fun `root binding rotation retains streams and rejects decreasing proofs`() {
        val ledger = initialized(Backing())
        ledger.install(boundary(trust = 2, key = 3, prefixes = mapOf("key-1" to 4))) {}
        ledger.install(boundary(trust = 3, key = 4, binding = "Ag==")) {}
        assertTrue(ledger.isEnvelopeDenied(envelope(nonce = "4", trust = 3, key = 4), scope))
        unavailable { ledger.install(boundary(trust = 2, key = 4, binding = "Aw==")) {} }
        unavailable { ledger.install(boundary(trust = 3, key = 4, prefixes = mapOf("key-1" to 3))) {} }
        assertEquals(4L, ledger.boundaries().single().closedNumericPrefixes["key-1"])
    }

    @Test fun `failed flush and ignored writes cannot confirm a retirement proof`() {
        val store = Backing()
        val ledger = initialized(store)
        store.failFlush = true
        unavailable { ledger.install(boundary(prefixes = mapOf("key-1" to 2))) {} }
        unavailable { ledger.isEnvelopeDenied(envelope(), scope) }
        assertFalse(PersistentInboundReplayDenialLedger(store.restart(), "device-1").isEnvelopeDenied(envelope(), scope))
        store.failFlush = false
        ledger.install(boundary(prefixes = mapOf("key-1" to 2))) {}
        assertTrue(ledger.isEnvelopeDenied(envelope(), scope))
        store.ignoreWrites = true
        unavailable { ledger.install(boundary(prefixes = mapOf("key-1" to 3))) {} }
        assertFalse(ledger.isEnvelopeDenied(envelope(nonce = "3"), scope))
    }

    @Test fun `scope mismatch corrupt state and invalid boundaries fail closed`() {
        val store = Backing()
        val ledger = initialized(store)
        unavailable { ledger.isEnvelopeDenied(envelope().copy(familyId = "other-family"), scope) }
        unavailable { ledger.install(boundary(key = -1)) {} }
        unavailable { ledger.install(boundary(trust = Int.MAX_VALUE.toLong() + 1)) {} }
        unavailable { ledger.install(boundary(prefixes = mapOf("key-1" to 1_000_000_000_000_000))) {} }
        val key = store.cache.keys.single { !it.endsWith(".required") }
        store.cache[key] = "{}"
        unavailable { ledger.boundaries() }
    }

    @Test fun `lost authority before installation does not manufacture denial`() {
        val ledger = initialized(Backing())
        unavailable { ledger.install(boundary(prefixes = mapOf("key-1" to 2))) { error("root changed") } }
        assertTrue(ledger.boundaries().isEmpty())
    }
}
