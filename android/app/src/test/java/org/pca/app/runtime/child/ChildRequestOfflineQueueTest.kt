package org.pca.app.runtime.child

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.pca.app.foundation.InMemoryPersistentStateStore
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
}
