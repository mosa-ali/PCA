package org.pca.app.runtime.sync

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.pca.app.runtime.sync.state.SyncConnectionState
import org.pca.app.runtime.sync.transport.InboundAppliedEnvelope

private class RecordingInboundHandler : InboundEnvelopeHandler {
    val handled = mutableListOf<String>()
    override suspend fun handle(messageId: String, senderDeviceId: String, messageType: String, payloadBase64: String) {
        handled.add(messageId)
    }
}

private fun buildOrchestrator(
    store: FakeDurableBackingStore,
    relay: FakeRelayHttpClient = FakeRelayHttpClient(),
    handler: RecordingInboundHandler = RecordingInboundHandler(),
    now: Long = 1_700_000_000_000L,
): ReconnectSyncOrchestrator {
    val sessionManager = DeviceSessionManager(relay, "device-1", signer = { "sig-1" }, nowEpochMillis = { now })
    return ReconnectSyncOrchestrator(
        connectivitySource = FakeConnectivitySource(),
        sessionManager = sessionManager,
        relayHttpClient = relay,
        outboxPort = FakeSyncOutboxPort(store),
        inboundHandler = handler,
        nowEpochMillis = { now },
    )
}

class ReconnectSyncOrchestratorTest {

    // ---- doc 40 Section 21: reboot while offline ----

    @Test
    fun `reboot offline -- new runtime instance over the same durable store keeps the pending queue, connection state stays OFFLINE`() = runTest {
        val store = FakeDurableBackingStore()
        val outbox1 = FakeSyncOutboxPort(store)
        outbox1.enqueue("msg-1", "family-1", "recipient-1", "ciphertext-b64", sequence = 1, expiresAtEpochMillis = 9_999_999_999_999L, createdAtEpochMillis = 1000L)

        val orchestrator1 = buildOrchestrator(store)
        assertEquals(SyncConnectionState.OFFLINE, orchestrator1.connectionState.value)
        // orchestrator1 is "destroyed" here -- just drop the reference, no shutdown call exists or is needed.

        val orchestrator2 = buildOrchestrator(store)
        assertEquals(SyncConnectionState.OFFLINE, orchestrator2.connectionState.value)
        val stillPending = FakeSyncOutboxPort(store).getReadyForDelivery(2000L)
        assertEquals(1, stillPending.size)
        assertEquals("msg-1", stillPending[0].messageId)
    }

    // ---- bounded batch ----

    @Test
    fun `outbound reconnect only submits up to MAX_OUTBOUND_BATCH_SIZE items per attempt`() = runTest {
        val store = FakeDurableBackingStore()
        val outbox = FakeSyncOutboxPort(store)
        for (i in 0 until MAX_OUTBOUND_BATCH_SIZE + 5) {
            outbox.enqueue("msg-$i", "family-1", "recipient-1", "ciphertext-$i", sequence = i.toLong(), expiresAtEpochMillis = 9_999_999_999_999L, createdAtEpochMillis = 0L)
        }
        val relay = FakeRelayHttpClient()
        val orchestrator = buildOrchestrator(store, relay)

        orchestrator.syncNow()

        assertEquals(1, relay.submittedBatches.size)
        assertEquals(MAX_OUTBOUND_BATCH_SIZE, relay.submittedBatches[0].size)
        val remaining = outbox.getReadyForDelivery(9_999_999L)
        assertEquals(5, remaining.size) // never silently lost -- left PENDING for the next attempt
    }

    // ---- backoff ----

    @Test
    fun `a transient submit failure schedules bounded backoff retry, not immediate resubmission`() = runTest {
        val store = FakeDurableBackingStore()
        val outbox = FakeSyncOutboxPort(store)
        outbox.enqueue("msg-1", "family-1", "recipient-1", "ciphertext-b64", sequence = 1, expiresAtEpochMillis = 9_999_999_999_999L, createdAtEpochMillis = 0L)
        val relay = FakeRelayHttpClient()
        relay.failNextSubmit = true
        val orchestrator = buildOrchestrator(store, relay, now = 1000L)

        orchestrator.syncNow()

        val readyImmediately = outbox.getReadyForDelivery(1000L)
        assertEquals(0, readyImmediately.size) // backed off, not immediately ready again
        val readyLater = outbox.getReadyForDelivery(1000L + 60_000L)
        assertEquals(1, readyLater.size) // becomes ready again once its backoff window passes
    }

    @Test
    fun `retries stop after MAX_RETRY_COUNT -- the item is finally given up on, never retried forever`() = runTest {
        val store = FakeDurableBackingStore()
        val outbox = FakeSyncOutboxPort(store)
        outbox.enqueue("msg-1", "family-1", "recipient-1", "ciphertext-b64", sequence = 1, expiresAtEpochMillis = 9_999_999_999_999L, createdAtEpochMillis = 0L)
        val relay = FakeRelayHttpClient()
        var time = 0L
        val orchestrator = buildOrchestrator(store, relay, now = time)
        val sessionManager = DeviceSessionManager(relay, "device-1", signer = { "sig-1" }, nowEpochMillis = { time })
        val realOrchestrator = ReconnectSyncOrchestrator(FakeConnectivitySource(), sessionManager, relay, outbox, RecordingInboundHandler(), nowEpochMillis = { time })

        repeat(org.pca.app.runtime.sync.backoff.MAX_RETRY_COUNT + 2) {
            relay.failNextSubmit = true
            realOrchestrator.syncNow()
            time += 24L * 60 * 60 * 1000 // fast-forward well past any bounded backoff window
        }

        val finalState = outbox.getReadyForDelivery(time)
        assertEquals(0, finalState.size) // given up, not stuck retrying forever, and not silently resurrected as ready
    }

    // ---- flapping / exactly-once inbound dispatch ----

    @Test
    fun `flapping reconnect -- repeated syncNow calls never re-dispatch the same inbound envelope twice`() = runTest {
        val store = FakeDurableBackingStore()
        val relay = FakeRelayHttpClient()
        val handler = RecordingInboundHandler()
        val orchestrator = buildOrchestrator(store, relay, handler)

        relay.enqueueInbound(InboundAppliedEnvelope("msg-1", "sender-1", "STATUS_SNAPSHOT", "cGF5bG9hZA=="))

        // online / offline / online / offline / online -- flap several times.
        repeat(5) { orchestrator.syncNow() }

        assertEquals(listOf("msg-1"), handler.handled)
    }

    @Test
    fun `two distinct inbound envelopes across separate reconnects are both dispatched, in order received`() = runTest {
        val store = FakeDurableBackingStore()
        val relay = FakeRelayHttpClient()
        val handler = RecordingInboundHandler()
        val orchestrator = buildOrchestrator(store, relay, handler)

        relay.enqueueInbound(InboundAppliedEnvelope("msg-1", "sender-1", "STATUS_SNAPSHOT", "cGF5bG9hZA=="))
        orchestrator.syncNow()
        relay.enqueueInbound(InboundAppliedEnvelope("msg-2", "sender-1", "STATUS_SNAPSHOT", "cGF5bG9hZA=="))
        orchestrator.syncNow()

        assertEquals(listOf("msg-1", "msg-2"), handler.handled)
    }

    // ---- connection state honesty ----

    @Test
    fun `connection state becomes LIVE only after a successful syncNow, never merely because the transport is up`() = runTest {
        val store = FakeDurableBackingStore()
        val orchestrator = buildOrchestrator(store)
        assertEquals(SyncConnectionState.OFFLINE, orchestrator.connectionState.value)

        orchestrator.syncNow()
        assertEquals(SyncConnectionState.LIVE, orchestrator.connectionState.value)
    }

    @Test
    fun `a network failure during syncNow does not falsely report LIVE`() = runTest {
        val store = FakeDurableBackingStore()
        val relay = FakeRelayHttpClient()
        relay.failNextList = true
        val orchestrator = buildOrchestrator(store, relay)

        orchestrator.syncNow()
        assertTrue(orchestrator.connectionState.value != SyncConnectionState.LIVE)
    }
}
