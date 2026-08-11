package org.pca.app.feature.screentime.persistence

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.concurrent.CyclicBarrier
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/**
 * NF-002: [UsedAuthorizationStore.claimAuthorization] must be a single atomic operation, not a
 * separate check-then-write pair — these tests line up many threads to actually race the same
 * id through a [CyclicBarrier] so they contend for real, rather than relying on interleaving
 * that happens to look safe on a single thread.
 */
class UsedAuthorizationStoreConcurrencyTest {

    @Test
    fun `two concurrent claims on the same id - exactly one succeeds`() {
        val store = InMemoryUsedAuthorizationStore()
        val successCount = raceClaims(store, auditId = "audit-race-2", concurrency = 2)

        assertEquals(1, successCount)
    }

    @Test
    fun `N concurrent claims on the same id - exactly one succeeds`() {
        val store = InMemoryUsedAuthorizationStore()
        val successCount = raceClaims(store, auditId = "audit-race-n", concurrency = 64)

        assertEquals(1, successCount)
    }

    @Test
    fun `a successful claim remains permanently unavailable for replay, including after further racing`() {
        val store = InMemoryUsedAuthorizationStore()
        assertTrue(store.claimAuthorization("audit-permanent"))

        // Pile on more concurrent attempts after the fact — none may ever succeed again.
        val successCount = raceClaims(store, auditId = "audit-permanent", concurrency = 32)

        assertEquals(0, successCount)
        assertFalse(store.claimAuthorization("audit-permanent"))
    }

    @Test
    fun `distinct ids racing concurrently do not interfere with each other`() {
        val store = InMemoryUsedAuthorizationStore()
        val ids = (1..16).map { "audit-distinct-$it" }
        val pool = Executors.newFixedThreadPool(16)
        try {
            val barrier = CyclicBarrier(ids.size)
            val results = ids.map { id ->
                pool.submit<Boolean> {
                    barrier.await(5, TimeUnit.SECONDS)
                    store.claimAuthorization(id)
                }
            }.map { it.get(5, TimeUnit.SECONDS) }

            assertTrue("every distinct id should be independently claimable", results.all { it })
        } finally {
            pool.shutdown()
        }
    }

    /** Fires [concurrency] threads at the same [auditId] simultaneously (synchronized via a
     * [CyclicBarrier] so they genuinely overlap) and returns how many claims actually won. */
    private fun raceClaims(store: UsedAuthorizationStore, auditId: String, concurrency: Int): Int {
        val pool = Executors.newFixedThreadPool(concurrency)
        val successCount = AtomicInteger(0)
        try {
            val barrier = CyclicBarrier(concurrency)
            val futures = (1..concurrency).map {
                pool.submit {
                    barrier.await(5, TimeUnit.SECONDS)
                    if (store.claimAuthorization(auditId)) {
                        successCount.incrementAndGet()
                    }
                }
            }
            futures.forEach { it.get(5, TimeUnit.SECONDS) }
        } finally {
            pool.shutdown()
        }
        return successCount.get()
    }
}
