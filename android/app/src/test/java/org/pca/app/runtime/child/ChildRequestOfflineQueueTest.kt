package org.pca.app.runtime.child

import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.runCurrent
import java.util.concurrent.CancellationException
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.pca.app.foundation.InMemoryPersistentStateStore
import org.pca.app.foundation.PersistentStateStore
import org.pca.app.runtime.FakeFamilySyncRuntimePort
import org.pca.app.runtime.port.ChildRequestPayload
import org.pca.app.runtime.port.FamilySyncConnectionState
import org.pca.app.runtime.port.FamilySyncRuntimePort
import org.pca.app.runtime.sync.MAX_OUTBOUND_BATCH_SIZE
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
    fun `reusing a request id for different content fails without replacing the original`() {
        val store = InMemoryPersistentStateStore()
        val queue = ChildRequestOfflineQueue(store)
        val original = payload("req-1")
        queue.enqueue(original)
        val before = store.getString("child_request_offline_queue_v1")

        val failure = runCatching {
            queue.enqueue(original.copy(kind = "INSTALL_APPROVAL", detail = "different request"))
        }.exceptionOrNull()

        assertTrue(failure is ChildRequestIdentityConflict)
        assertEquals(before, store.getString("child_request_offline_queue_v1"))
        assertEquals(original, queue.pending().single().payload)
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
    fun `enqueue confirms the durable snapshot before returning and a failed commit rolls back before send`() = runTest {
        val store = FlushFaultStore()
        val queue = ChildRequestOfflineQueue(store)
        store.failOnFlushNumber = 2 // marker commit succeeds; candidate snapshot commit fails after apply

        val failure = runCatching { queue.enqueue(payload("req-not-durable")) }.exceptionOrNull()

        assertTrue(failure is ChildRequestQueueUnavailable)
        assertNull(store.getString("child_request_offline_queue_v1"))
        assertNull(store.getString("child_request_offline_queue_v1.pending_write"))
        val reloaded = ChildRequestOfflineQueue(store)
        assertTrue(reloaded.pending().isEmpty())
        val port = FakeFamilySyncRuntimePort(state = FamilySyncConnectionState.LIVE)
        assertEquals(0, reloaded.flush(port))
        assertTrue("a request whose durable enqueue failed must not reach the transport", port.submitted.isEmpty())
    }

    @Test
    fun `cancellation during the original write rolls back and propagates`() {
        val store = PlannedFlushFailureStore().apply {
            failuresByFlush[2] = CancellationException("cancelled while committing candidate")
        }
        val queue = ChildRequestOfflineQueue(store, "queue-a")

        assertThrows(CancellationException::class.java) {
            queue.enqueue(payload("req-cancelled"))
        }

        assertTrue(queue.pending().isEmpty())
        assertNull(store.getString("queue-a.pending_write"))
    }

    @Test
    fun `cancellation during rollback propagates and poisons only its queue key`() {
        val store = PlannedFlushFailureStore().apply {
            failuresByFlush[2] = IllegalStateException("candidate commit failed")
            failuresByFlush[3] = CancellationException("cancelled during rollback")
        }
        val queue = ChildRequestOfflineQueue(store, "queue-a")
        val sibling = ChildRequestOfflineQueue(store, "queue-b")

        assertThrows(CancellationException::class.java) {
            queue.enqueue(payload("req-cancelled-rollback"))
        }

        assertQueueUnavailable { queue.pending() }
        sibling.enqueue(payload("req-sibling"))
        assertEquals(listOf("req-sibling"), sibling.pending().map { it.payload.requestId })
    }

    @Test
    fun `fatal rollback error propagates and poisons only its queue key`() {
        val store = PlannedFlushFailureStore().apply {
            failuresByFlush[2] = IllegalStateException("candidate commit failed")
            failuresByFlush[3] = AssertionError("fatal rollback failure")
        }
        val queue = ChildRequestOfflineQueue(store, "queue-a")
        val sibling = ChildRequestOfflineQueue(store, "queue-b")

        assertThrows(AssertionError::class.java) {
            queue.enqueue(payload("req-fatal-rollback"))
        }

        assertQueueUnavailable { queue.pending() }
        sibling.enqueue(payload("req-sibling"))
        assertEquals(listOf("req-sibling"), sibling.pending().map { it.payload.requestId })
    }

    @Test
    fun `ordinary rollback failure poisons only its queue key and leaves sibling queue usable`() {
        val store = PlannedFlushFailureStore().apply {
            failuresByFlush[2] = IllegalStateException("candidate commit failed")
            failuresByFlush[3] = IllegalStateException("rollback flush failed")
        }
        val queue = ChildRequestOfflineQueue(store, "queue-a")
        val sibling = ChildRequestOfflineQueue(store, "queue-b")

        assertQueueUnavailable { queue.enqueue(payload("req-rollback-failed")) }

        assertQueueUnavailable { queue.pending() }
        sibling.enqueue(payload("req-sibling"))
        assertEquals(listOf("req-sibling"), sibling.pending().map { it.payload.requestId })
    }

    @Test
    fun `legacy and malformed write markers are preserved and fail closed`() {
        val store = InMemoryPersistentStateStore()
        val raw = "req-1|SKIP_BREAK|ZGV0YWls|0|PENDING_SYNC_LOCAL"
        store.putString("child_request_offline_queue_v1", raw)
        val pendingKey = "child_request_offline_queue_v1.pending_write"
        for (marker in listOf(
            "child-request-queue-write-v1",
            "child-request-queue-write-v2|sha256:invalid|absent",
            "malformed-marker",
        )) {
            store.putString(pendingKey, marker)
            val queue = ChildRequestOfflineQueue(store)

            assertQueueUnavailable { queue.pending() }
            assertEquals(raw, store.getString("child_request_offline_queue_v1"))
            assertEquals(marker, store.getString(pendingKey))
        }
    }

    @Test
    fun `present but unreadable pending marker blocks reads enqueue and outbound submission`() = runTest {
        for (presenceCheckFails in listOf(false, true)) {
            val backing = InMemoryPersistentStateStore()
            val originalQueue = ChildRequestOfflineQueue(backing)
            originalQueue.enqueue(payload("req-existing"))
            val queueKey = "child_request_offline_queue_v1"
            val markerKey = "$queueKey.pending_write"
            val queueBytes = backing.getString(queueKey)
            val markerBytes = "retained-unreadable-marker"
            backing.putString(markerKey, markerBytes)
            backing.flush()

            val unreadableStore = UnreadablePendingWriteMarkerStore(backing, presenceCheckFails)
            val queue = ChildRequestOfflineQueue(unreadableStore)
            val port = FakeFamilySyncRuntimePort(state = FamilySyncConnectionState.LIVE)

            assertQueueUnavailable { queue.pending() }
            assertQueueUnavailable { queue.enqueue(payload("req-new")) }
            assertQueueUnavailableSuspend { queue.flush(port) }

            assertEquals(queueBytes, backing.getString(queueKey))
            assertEquals(markerBytes, backing.getString(markerKey))
            assertTrue("unresolved marker must never authorize a transport submission", port.submitted.isEmpty())
        }
    }

    @Test
    fun `process death with the exact prior snapshot recovers and clears the marker`() {
        val durableState = InMemoryPersistentStateStore()
        val crashingStore = CrashAtFlushStore(durableState)
        val queue = ChildRequestOfflineQueue(crashingStore)
        val original = payload("req-before-crash")
        queue.enqueue(original)
        crashingStore.crashAfterFlushNumber = crashingStore.flushCount + 1

        val death = runCatching { queue.enqueue(payload("req-interrupted")) }.exceptionOrNull()

        assertTrue(death is SimulatedProcessDeath)
        val pendingKey = "child_request_offline_queue_v1.pending_write"
        val marker = durableState.getString(pendingKey)
        assertTrue(marker?.startsWith("child-request-queue-write-v2|") == true)
        assertFalse(marker.orEmpty().contains("req-interrupted"))

        // A fresh queue over the durable backing store models a new process after the crash.
        val restartedQueue = ChildRequestOfflineQueue(durableState)
        assertEquals(listOf(original), restartedQueue.pending().map { it.payload })
        assertNull(durableState.getString(pendingKey))
    }

    @Test
    fun `process death with the exact candidate snapshot recovers and clears the marker`() {
        val durableState = InMemoryPersistentStateStore()
        val crashingStore = CrashAtFlushStore(durableState)
        val queue = ChildRequestOfflineQueue(crashingStore)
        val original = payload("req-before-crash")
        val candidate = payload("req-candidate")
        queue.enqueue(original)
        crashingStore.crashAfterFlushNumber = crashingStore.flushCount + 2

        val death = runCatching { queue.enqueue(candidate) }.exceptionOrNull()

        assertTrue(death is SimulatedProcessDeath)
        val pendingKey = "child_request_offline_queue_v1.pending_write"
        val marker = durableState.getString(pendingKey)
        assertTrue(marker?.startsWith("child-request-queue-write-v2|") == true)
        assertFalse(marker.orEmpty().contains("req-candidate"))

        val restartedQueue = ChildRequestOfflineQueue(durableState)
        assertEquals(listOf(original, candidate), restartedQueue.pending().map { it.payload })
        assertNull(durableState.getString(pendingKey))
    }

    @Test
    fun `present empty prior snapshot is distinguished from an absent snapshot`() {
        val durableState = InMemoryPersistentStateStore()
        durableState.putString("child_request_offline_queue_v1", "")
        durableState.flush()
        val crashingStore = CrashAtFlushStore(durableState)
        val queue = ChildRequestOfflineQueue(crashingStore)
        crashingStore.crashAfterFlushNumber = crashingStore.flushCount + 1

        val death = runCatching { queue.enqueue(payload("req-after-empty")) }.exceptionOrNull()

        assertTrue(death is SimulatedProcessDeath)
        val marker = requireNotNull(durableState.getString("child_request_offline_queue_v1.pending_write"))
        val priorFingerprint = marker.split('|').getOrNull(1)
        assertTrue(priorFingerprint?.startsWith("sha256:") == true)
        assertFalse(priorFingerprint == "absent")

        val restartedQueue = ChildRequestOfflineQueue(durableState)
        assertTrue(restartedQueue.pending().isEmpty())
        assertEquals("", durableState.getString("child_request_offline_queue_v1"))
        assertNull(durableState.getString("child_request_offline_queue_v1.pending_write"))
    }

    @Test
    fun `unknown queue snapshot preserves descriptor and fails closed after process death`() {
        val durableState = InMemoryPersistentStateStore()
        val crashingStore = CrashAtFlushStore(durableState)
        val queue = ChildRequestOfflineQueue(crashingStore)
        queue.enqueue(payload("req-before-crash"))
        crashingStore.crashAfterFlushNumber = crashingStore.flushCount + 1

        val death = runCatching { queue.enqueue(payload("req-interrupted")) }.exceptionOrNull()

        assertTrue(death is SimulatedProcessDeath)
        val pendingKey = "child_request_offline_queue_v1.pending_write"
        val marker = requireNotNull(durableState.getString(pendingKey))
        val unknownSnapshot = "not-a-recorded-snapshot"
        durableState.putString("child_request_offline_queue_v1", unknownSnapshot)
        durableState.flush()

        assertQueueUnavailable { ChildRequestOfflineQueue(durableState).pending() }
        assertEquals(unknownSnapshot, durableState.getString("child_request_offline_queue_v1"))
        assertEquals(marker, durableState.getString(pendingKey))
    }

    @Test
    fun `transport observes the request only after durable snapshot and marker clear`() = runTest {
        val store = FlushFaultStore()
        val queue = ChildRequestOfflineQueue(store)
        queue.enqueue(payload("req-durable"))
        val persisted = store.getString("child_request_offline_queue_v1")
        val port = object : FamilySyncRuntimePort {
            override fun currentConnectionState() = FamilySyncConnectionState.LIVE
            override fun lastSuccessfulSyncEpochMillis(): Long? = null
            override suspend fun submitChildRequest(request: ChildRequestPayload): Boolean {
                assertEquals("request snapshot must have crossed a synchronous flush before send", persisted,
                    store.getString("child_request_offline_queue_v1"))
                assertNull(store.getString("child_request_offline_queue_v1.pending_write"))
                return true
            }
        }

        assertEquals(1, queue.flush(port))
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
    fun `flush limits each attempt to the shared outbound batch size and leaves remainder for next flush`() = runTest {
        val queue = ChildRequestOfflineQueue(InMemoryPersistentStateStore())
        val requestIds = (0 until (MAX_OUTBOUND_BATCH_SIZE + 2)).map { "req-$it" }
        requestIds.forEach { queue.enqueue(payload(it)) }
        val port = FakeFamilySyncRuntimePort(state = FamilySyncConnectionState.LIVE)

        val firstFlush = queue.flush(port)

        assertEquals(MAX_OUTBOUND_BATCH_SIZE, firstFlush)
        assertEquals(requestIds.take(MAX_OUTBOUND_BATCH_SIZE), port.submitted.map { it.requestId })
        assertEquals(requestIds.drop(MAX_OUTBOUND_BATCH_SIZE), queue.pending().map { it.payload.requestId })

        val secondFlush = queue.flush(port)

        assertEquals(2, secondFlush)
        assertEquals(requestIds, port.submitted.map { it.requestId })
        assertTrue(queue.pending().isEmpty())
    }

    @Test
    fun `flush stops submitting when the family channel becomes stale during a prior send`() = runTest {
        val queue = ChildRequestOfflineQueue(InMemoryPersistentStateStore())
        queue.enqueue(payload("req-1"))
        queue.enqueue(payload("req-2"))
        val sent = mutableListOf<String>()
        var state = FamilySyncConnectionState.LIVE
        val port = object : FamilySyncRuntimePort {
            override fun currentConnectionState() = state
            override fun lastSuccessfulSyncEpochMillis(): Long? = null
            override suspend fun submitChildRequest(request: ChildRequestPayload): Boolean {
                sent += request.requestId
                state = FamilySyncConnectionState.STALE
                return true
            }
        }

        val submitted = queue.flush(port)

        assertEquals(1, submitted)
        assertEquals(listOf("req-1"), sent)
        assertEquals(listOf("req-2"), queue.pending().map { it.payload.requestId })
    }

    @Test
    @OptIn(ExperimentalCoroutinesApi::class)
    fun `separate queue wrappers serialize overlapping flush and retry after a false result`() = runTest {
        val store = InMemoryPersistentStateStore()
        val firstQueue = ChildRequestOfflineQueue(store)
        val secondQueue = ChildRequestOfflineQueue(store)
        firstQueue.enqueue(payload("req-race"))
        val firstSubmitEntered = CompletableDeferred<Unit>()
        val releaseFirstSubmit = CompletableDeferred<Unit>()
        val submitCalls = AtomicInteger()
        val port = object : FamilySyncRuntimePort {
            override fun currentConnectionState() = FamilySyncConnectionState.LIVE
            override fun lastSuccessfulSyncEpochMillis(): Long? = null
            override suspend fun submitChildRequest(request: ChildRequestPayload): Boolean =
                when (submitCalls.incrementAndGet()) {
                    1 -> {
                        firstSubmitEntered.complete(Unit)
                        releaseFirstSubmit.await()
                        false
                    }
                    else -> true
                }
        }

        val firstFlush = async { firstQueue.flush(port) }
        firstSubmitEntered.await()
        val secondStarted = CompletableDeferred<Unit>()
        val secondFlush = async {
            secondStarted.complete(Unit)
            secondQueue.flush(port)
        }
        secondStarted.await()
        runCurrent()

        // The second wrapper waits while the first request has an unknown outcome.
        assertEquals(1, submitCalls.get())
        assertFalse(secondFlush.isCompleted)

        // False leaves the entry pending. Once the first flush releases the shared mutex, the
        // queued second flush retries it and can persist SUBMITTED.
        releaseFirstSubmit.complete(Unit)
        assertEquals(0, firstFlush.await())
        assertEquals(1, secondFlush.await())
        assertEquals(2, submitCalls.get())
        assertTrue(firstQueue.pending().isEmpty())
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
    fun `negative enqueue timestamp is rejected before durable queue mutation`() {
        val store = InMemoryPersistentStateStore()
        val queue = ChildRequestOfflineQueue(store, "child-requests")

        assertThrows(IllegalArgumentException::class.java) {
            queue.enqueue(payload("req-negative-time").copy(createdAtEpochMillis = -1L))
        }

        assertNull(store.getString("child-requests"))
    }

    @Test
    fun `negative and noncanonical persisted timestamps fail closed without rewriting or sending`() = runTest {
        val store = InMemoryPersistentStateStore()
        val key = "child-requests"
        val queue = ChildRequestOfflineQueue(store, key)
        val port = FakeFamilySyncRuntimePort(state = FamilySyncConnectionState.LIVE)
        for (timestamp in listOf("-1", "+1", "01")) {
            val raw = "req-1|SKIP_BREAK|ZGV0YWls|$timestamp|PENDING_SYNC_LOCAL"
            store.putString(key, raw)

            assertQueueUnavailable { queue.pending() }
            assertQueueUnavailableSuspend { queue.flush(port) }

            assertEquals(raw, store.getString(key))
            assertTrue(port.submitted.isEmpty())
        }
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

    private class FlushFaultStore(
        private val backing: InMemoryPersistentStateStore = InMemoryPersistentStateStore(),
    ) : PersistentStateStore {
        override val coordinationLock: Any get() = backing.coordinationLock
        var flushCount: Int = 0
            private set
        var failOnFlushNumber: Int? = null

        override fun getString(key: String): String? = backing.getString(key)
        override fun putString(key: String, value: String) = backing.putString(key, value)
        override fun remove(key: String) = backing.remove(key)
        override fun contains(key: String): Boolean = backing.contains(key)
        override fun clear() = backing.clear()
        override fun flush() {
            flushCount++
            if (flushCount == failOnFlushNumber) throw IllegalStateException("simulated commit failure")
            backing.flush()
        }
    }

    private class UnreadablePendingWriteMarkerStore(
        private val backing: InMemoryPersistentStateStore,
        private val presenceCheckFails: Boolean,
    ) : PersistentStateStore by backing {
        private val markerKey = "child_request_offline_queue_v1.pending_write"

        override fun getString(key: String): String? =
            if (key == markerKey) null else backing.getString(key)

        override fun contains(key: String): Boolean = when {
            key != markerKey -> backing.contains(key)
            presenceCheckFails -> error("presence check unavailable")
            else -> true
        }
    }

    private class CrashAtFlushStore(
        private val backing: InMemoryPersistentStateStore,
    ) : PersistentStateStore by backing {
        var flushCount = 0
            private set
        var crashAfterFlushNumber: Int? = null

        override fun flush() {
            flushCount++
            backing.flush()
            if (flushCount == crashAfterFlushNumber) throw SimulatedProcessDeath()
        }
    }

    private class SimulatedProcessDeath : Error("simulated process death after durable flush")

    private class PlannedFlushFailureStore(
        private val backing: InMemoryPersistentStateStore = InMemoryPersistentStateStore(),
    ) : PersistentStateStore by backing {
        var flushCount = 0
            private set
        val failuresByFlush: MutableMap<Int, Throwable> = mutableMapOf()

        override fun flush() {
            flushCount++
            failuresByFlush.remove(flushCount)?.let { throw it }
            backing.flush()
        }
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
