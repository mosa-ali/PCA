package org.pca.app.feature.screentime.persistence

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.pca.app.foundation.PersistentStateStore
import org.pca.app.foundation.PersistentStateStoreDurabilityFailure
import java.util.concurrent.CyclicBarrier
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

class PersistentUsedAuthorizationStoreTest {

    @Test
    fun `claim is flushed before success and remains claimed through a new adapter`() {
        val state = SharedState()
        val auditId = "parent-audit-92f63"
        val first = PersistentUsedAuthorizationStore(SharedPersistentStateStore(state))

        assertTrue(first.claimAuthorization(auditId))
        assertEquals("successful claim must cross the durability barrier once", 1, state.flushCalls.get())

        val afterRestart = PersistentUsedAuthorizationStore(SharedPersistentStateStore(state))
        assertFalse(afterRestart.claimAuthorization(auditId))
        assertEquals("duplicate claims must not flush again", 1, state.flushCalls.get())
        assertTrue("raw audit IDs must not be used as storage keys", state.values.keys.none { auditId in it })
    }

    @Test
    fun `concurrent adapters sharing backing coordination lock have one durable winner`() {
        val state = SharedState()
        val adapters = (1..32).map {
            PersistentUsedAuthorizationStore(SharedPersistentStateStore(state))
        }
        val pool = Executors.newFixedThreadPool(adapters.size)
        try {
            val barrier = CyclicBarrier(adapters.size)
            val results = adapters.map { adapter ->
                pool.submit<Boolean> {
                    barrier.await(5, TimeUnit.SECONDS)
                    adapter.claimAuthorization("audit-concurrent")
                }
            }.map { it.get(10, TimeUnit.SECONDS) }

            assertEquals(1, results.count { it })
            assertEquals(1, state.flushCalls.get())
        } finally {
            pool.shutdownNow()
        }
    }

    @Test
    fun `distinct authorizations remain independently claimable`() {
        val state = SharedState()
        val store = PersistentUsedAuthorizationStore(SharedPersistentStateStore(state))

        assertTrue(store.claimAuthorization("audit-one"))
        assertTrue(store.claimAuthorization("audit-two"))
        assertFalse(store.claimAuthorization("audit-one"))
        assertEquals(2, state.flushCalls.get())
    }

    @Test
    fun `failed durability barrier propagates and claim is not reported as successful`() {
        val state = SharedState(failFlush = true)
        val store = PersistentUsedAuthorizationStore(SharedPersistentStateStore(state))

        try {
            store.claimAuthorization("audit-flush-failure")
            throw AssertionError("claim must not succeed when the backing store cannot flush")
        } catch (_: PersistentStateStoreDurabilityFailure) {
            // Expected: the caller must not apply an authorization whose durable claim failed.
        }

        state.failFlush = false
        assertFalse("a possibly persisted failed claim must still fail closed", store.claimAuthorization("audit-flush-failure"))
        assertEquals(1, state.flushCalls.get())
    }

    @Test
    fun `blank authorization ID is rejected before any storage access`() {
        val state = SharedState()
        val store = PersistentUsedAuthorizationStore(SharedPersistentStateStore(state))

        try {
            store.claimAuthorization("  \t")
            throw AssertionError("blank audit ID must be rejected")
        } catch (_: IllegalArgumentException) {
            // Expected.
        }
        assertTrue(state.values.isEmpty())
        assertEquals(0, state.flushCalls.get())
    }

    private class SharedState(
        @Volatile var failFlush: Boolean = false,
    ) {
        val lock = Any()
        val values = mutableMapOf<String, String>()
        val flushCalls = AtomicInteger()
    }

    /** Simulates separate wrappers for one persistent file with a shared in-process lock. */
    private class SharedPersistentStateStore(
        private val shared: SharedState,
    ) : PersistentStateStore {
        override val coordinationLock: Any = shared.lock

        override fun getString(key: String): String? = synchronized(shared.lock) { shared.values[key] }

        override fun putString(key: String, value: String) {
            synchronized(shared.lock) { shared.values[key] = value }
        }

        override fun remove(key: String) {
            synchronized(shared.lock) { shared.values.remove(key) }
        }

        override fun contains(key: String): Boolean = synchronized(shared.lock) { key in shared.values }

        override fun clear() {
            synchronized(shared.lock) { shared.values.clear() }
        }

        override fun flush() {
            shared.flushCalls.incrementAndGet()
            if (shared.failFlush) throw PersistentStateStoreDurabilityFailure()
        }
    }
}
