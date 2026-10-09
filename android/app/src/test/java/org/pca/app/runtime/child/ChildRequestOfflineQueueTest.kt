package org.pca.app.runtime.child

import kotlinx.coroutines.test.runTest
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.pca.app.foundation.InMemoryPersistentStateStore
import org.pca.app.foundation.PersistentStateStore
import org.pca.app.runtime.FakeFamilySyncRuntimePort
import org.pca.app.runtime.port.ChildRequestPayload
import org.pca.app.runtime.port.FamilySyncConnectionState
import org.robolectric.RobolectricTestRunner

/** Robolectric is required because [ChildRequestOfflineQueue] encodes through `android.util.Base64`,
 * unavailable on a plain JVM unit-test classloader. */
@RunWith(RobolectricTestRunner::class)
class ChildRequestOfflineQueueTest {

    private fun payload(id: String) = ChildRequestPayload(id, "SKIP_BREAK", "detail", 0L)

    @Test
    fun `enqueue is idempotent by request id`() {
        val queue = ChildRequestOfflineQueue(InMemoryPersistentStateStore())

        queue.enqueue(payload("req-1"))
        queue.enqueue(payload("req-1"))

        assertEquals(1, queue.pending().size)
    }

    @Test
    fun `a queued request survives a fresh queue instance over the same store -- durable across process death`() {
        val store = InMemoryPersistentStateStore()
        ChildRequestOfflineQueue(store).enqueue(payload("req-1"))

        val reloaded = ChildRequestOfflineQueue(store)

        assertEquals(1, reloaded.pending().size)
        assertEquals(ChildRequestLocalStatus.PENDING_SYNC_LOCAL, reloaded.pending().first().status)
    }

    @Test
    fun `flush is a no-op unless the sync port reports LIVE`() = runTest {
        val queue = ChildRequestOfflineQueue(InMemoryPersistentStateStore())
        queue.enqueue(payload("req-1"))
        val port = FakeFamilySyncRuntimePort(state = FamilySyncConnectionState.SYNCING)

        val submitted = queue.flush(port)

        assertEquals(0, submitted)
        assertEquals(1, queue.pending().size)
        assertTrue(port.submitted.isEmpty())
    }

    @Test
    fun `flush submits every pending entry once the sync port is LIVE, and marks them submitted`() = runTest {
        val queue = ChildRequestOfflineQueue(InMemoryPersistentStateStore())
        queue.enqueue(payload("req-1"))
        queue.enqueue(payload("req-2"))
        val port = FakeFamilySyncRuntimePort(state = FamilySyncConnectionState.LIVE)

        val submitted = queue.flush(port)

        assertEquals(2, submitted)
        assertEquals(0, queue.pending().size)
        assertEquals(2, port.submitted.size)
    }

    @Test
    fun `flush never resubmits an already-submitted entry`() = runTest {
        val queue = ChildRequestOfflineQueue(InMemoryPersistentStateStore())
        queue.enqueue(payload("req-1"))
        val port = FakeFamilySyncRuntimePort(state = FamilySyncConnectionState.LIVE)
        queue.flush(port)

        queue.flush(port)

        assertEquals(1, port.submitted.size)
    }

    @Test
    fun `corrupt persisted row fails closed and is preserved by read and mutation attempts`() = runTest {
        val store = InMemoryPersistentStateStore()
        val key = "child-requests"
        val raw = "req-1|SKIP_BREAK|ZGV0YWls|0|PENDING_SYNC_LOCAL\nnot-a-valid-record"
        store.putString(key, raw)
        val queue = ChildRequestOfflineQueue(store, key)

        assertQueueUnavailable { queue.pending() }
        assertQueueUnavailable { queue.enqueue(payload("req-2")) }
        val port = FakeFamilySyncRuntimePort(state = FamilySyncConnectionState.LIVE)
        assertQueueUnavailableSuspend { queue.flush(port) }

        assertEquals("corrupt bytes must remain available for recovery; no partial rewrite is allowed", raw, store.getString(key))
        assertTrue("corrupt rows must never be submitted", port.submitted.isEmpty())
    }

    @Test
    fun `duplicate persisted request identities fail closed without rewriting the queue`() {
        val store = InMemoryPersistentStateStore()
        val key = "child-requests"
        val raw = "req-1|SKIP_BREAK|ZGV0YWls|0|PENDING_SYNC_LOCAL\nreq-1|SKIP_BREAK|ZGV0YWls|1|SUBMITTED"
        store.putString(key, raw)
        val queue = ChildRequestOfflineQueue(store, key)

        assertQueueUnavailable { queue.pending() }

        assertEquals(raw, store.getString(key))
    }

    @Test
    fun `invalid request identity delimiters are rejected before durable queue mutation`() {
        val store = InMemoryPersistentStateStore()
        val key = "child-requests"
        val queue = ChildRequestOfflineQueue(store, key)

        val failure = runCatching { queue.enqueue(payload("bad|id")) }.exceptionOrNull()

        assertTrue(failure is IllegalArgumentException)
        assertEquals(null, store.getString(key))
    }

    @Test
    fun `valid queue survives reload and resumes submission after process death`() = runTest {
        val store = InMemoryPersistentStateStore()
        ChildRequestOfflineQueue(store).enqueue(payload("req-after-restart"))
        val reloaded = ChildRequestOfflineQueue(store)
        val port = FakeFamilySyncRuntimePort(state = FamilySyncConnectionState.LIVE)

        assertEquals(1, reloaded.flush(port))
        assertEquals(1, port.submitted.size)
        assertEquals(0, ChildRequestOfflineQueue(store).pending().size)
    }

    @Test
    fun `separate queue wrappers serialize read modify write through shared store lock`() {
        val store = BlockingFirstReadStore()
        val first = ChildRequestOfflineQueue(store)
        val second = ChildRequestOfflineQueue(store)
        val failure = AtomicReference<Throwable?>(null)
        val firstThread = Thread {
            runCatching { first.enqueue(payload("req-first")) }.exceptionOrNull()?.let(failure::set)
        }
        firstThread.start()
        assertTrue("first enqueue should enter the backing read", store.firstReadEntered.await(5, TimeUnit.SECONDS))

        val secondThread = Thread {
            runCatching { second.enqueue(payload("req-second")) }.exceptionOrNull()?.let(failure::set)
        }
        secondThread.start()
        val secondEnteredWhileFirstHeld = store.secondReadEntered.await(200, TimeUnit.MILLISECONDS)
        store.releaseFirstRead.countDown()
        firstThread.join(5_000)
        secondThread.join(5_000)

        assertFalse("a second wrapper must wait for the shared state-store transaction lock", secondEnteredWhileFirstHeld)
        assertFalse("both queue operations should finish", firstThread.isAlive || secondThread.isAlive)
        failure.get()?.let { throw AssertionError("queue operation failed", it) }
        assertEquals(setOf("req-first", "req-second"), first.pending().map { it.payload.requestId }.toSet())
    }

    private fun assertQueueUnavailable(block: () -> Unit) {
        val failure = runCatching(block).exceptionOrNull()
        assertTrue("corrupt persisted queue must fail closed with a typed error", failure is ChildRequestQueueUnavailable)
    }

    private suspend fun assertQueueUnavailableSuspend(block: suspend () -> Unit) {
        val failure = runCatching { block() }.exceptionOrNull()
        assertTrue("corrupt persisted queue must fail closed with a typed error", failure is ChildRequestQueueUnavailable)
    }

    private class BlockingFirstReadStore : PersistentStateStore {
        private val backing = InMemoryPersistentStateStore()
        override val coordinationLock: Any get() = backing.coordinationLock
        private val readCount = AtomicInteger()
        val firstReadEntered = CountDownLatch(1)
        val releaseFirstRead = CountDownLatch(1)
        val secondReadEntered = CountDownLatch(1)

        override fun getString(key: String): String? {
            if (readCount.incrementAndGet() == 1) {
                firstReadEntered.countDown()
                check(releaseFirstRead.await(5, TimeUnit.SECONDS)) { "test did not release first read" }
            } else {
                secondReadEntered.countDown()
            }
            return backing.getString(key)
        }

        override fun putString(key: String, value: String) = backing.putString(key, value)
        override fun remove(key: String) = backing.remove(key)
        override fun contains(key: String): Boolean = backing.contains(key)
        override fun clear() = backing.clear()
        override fun flush() = backing.flush()
    }
}
