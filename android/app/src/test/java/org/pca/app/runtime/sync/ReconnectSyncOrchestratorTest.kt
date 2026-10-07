package org.pca.app.runtime.sync

import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.pca.app.foundation.InMemoryPersistentStateStore
import org.pca.app.runtime.sync.inbox.PersistentCiphertextInbox
import org.pca.app.runtime.sync.inbox.RuntimeInboxScope
import org.pca.app.runtime.sync.inbox.*
import org.pca.app.runtime.sync.envelope.*
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
    relay: org.pca.app.runtime.sync.transport.RelayHttpClient = FakeRelayHttpClient(),
    handler: InboundEnvelopeHandler = RecordingInboundHandler(),
    now: Long = 1_700_000_000_000L,
    inbox: PersistentCiphertextInbox = PersistentCiphertextInbox(InMemoryPersistentStateStore(), "device-1"),
    assertKeyCustody: () -> Unit = {},
    expectedFamilyId: String = "family-1",
    consumer: VerifiedInboundCommandConsumer? = null,
): ReconnectSyncOrchestrator {
    val sessionManager = DeviceSessionManager(relay, "device-1", signer = { "sig-1" }, nowEpochMillis = { now }, assertKeyCustody = assertKeyCustody)
    return ReconnectSyncOrchestrator(
        connectivitySource = FakeConnectivitySource(),
        sessionManager = sessionManager,
        relayHttpClient = relay,
        outboxPort = FakeSyncOutboxPort(store),
        inboundHandler = handler,
        nowEpochMillis = { now },
        ciphertextInbox = inbox,
        expectedFamilyId = expectedFamilyId,
        inboundConsumer = consumer,
    )
}

private fun inbound(id: String): InboundAppliedEnvelope {
    val wire = String(envelopeToRelayCiphertext(FamilyEnvelope(1, 0, id, "family-1", "sender-1",
        RecipientBinding.Device("device-1"), "key-1", "STATUS_SNAPSHOT", 1, 1, "nonce-$id",
        1_700_000_000_000L, 1_700_000_060_000L, "1.0.0", null, byteArrayOf(1), "signature-1")), Charsets.UTF_8)
    return InboundAppliedEnvelope(id, "sender-1", "STATUS_SNAPSHOT", "AQ==", wire)
}

class ReconnectSyncOrchestratorTest {
    @Test fun `terminal application clears pending status while unavailable work remains pending`() = runTest {
        val store = InMemoryPersistentStateStore()
        val inbox = PersistentCiphertextInbox(store, "device-1")
        val journal = PersistentInboundApplicationJournal(store, "device-1")
        val consumer = VerifiedInboundCommandConsumer(journal, InboundCommandVerifier { candidate, _ ->
            if (candidate.messageId == "completed") InboundVerificationResult.Accepted("AQ==", "Ag==") {}
            else InboundVerificationResult.Unavailable
        }, object : InboundCommandApplier {
            override suspend fun reconcile(intent: InboundApplicationIntent) = InboundEffectRecovery.NotApplied
            override suspend fun apply(intent: InboundApplicationIntent, assertAuthority: () -> Unit): InboundApplicationOutcome {
                assertAuthority(); return InboundApplicationOutcome.APPLIED
            }
        }, { 1_700_000_001_000L })
        val relay = FakeRelayHttpClient().also { it.enqueueInbound(inbound("completed")) }
        val orchestrator = buildOrchestrator(FakeDurableBackingStore(), relay, inbox = inbox, consumer = consumer)
        assertEquals(RuntimeCustodyOutcome.COMPLETE, orchestrator.syncNow())
        assertEquals(SyncConnectionState.LIVE, orchestrator.connectionState.value)
        assertEquals(1, inbox.pendingCryptoCount())
        assertEquals(InboundApplicationOutcome.APPLIED, journal.records().single().outcome)
        relay.enqueueInbound(inbound("unavailable"))
        assertEquals(RuntimeCustodyOutcome.COMPLETE, orchestrator.syncNow())
        assertTrue(orchestrator.connectionState.value != SyncConnectionState.LIVE)
        assertEquals(2, inbox.pendingCryptoCount())
    }

    @Test fun `full journal blocks new host effect and ACK without evicting replay receipts`() = runTest {
        val store = InMemoryPersistentStateStore()
        val inbox = PersistentCiphertextInbox(store, "device-1")
        val journal = PersistentInboundApplicationJournal(store, "device-1")
        val scope = RuntimeInboxScope("family-1", "device-1")
        repeat(64) { index ->
            val id = "completed-$index"
            val intent = InboundApplicationIntent(java.util.UUID.randomUUID().toString(), scope, id,
                inbound(id).envelopeWire!!, "AQ==", "Ag==", 1_700_000_001_000L)
            journal.prepare(intent)
            journal.complete(intent, InboundApplicationOutcome.APPLIED, intent.preparedAtEpochMillis)
        }
        val originals = journal.records()
        var effectCalls = 0
        val consumer = VerifiedInboundCommandConsumer(journal,
            InboundCommandVerifier { _, _ -> InboundVerificationResult.Accepted("AQ==", "Ag==") {} },
            object : InboundCommandApplier {
                override suspend fun reconcile(intent: InboundApplicationIntent) = InboundEffectRecovery.NotApplied
                override suspend fun apply(intent: InboundApplicationIntent, assertAuthority: () -> Unit): InboundApplicationOutcome {
                    effectCalls++; error("Full journal must prevent effect")
                }
            }, { 1_700_000_001_000L })
        val relay = FakeRelayHttpClient().also { it.enqueueInbound(inbound("next-command")) }
        val orchestrator = buildOrchestrator(FakeDurableBackingStore(), relay, inbox = inbox, consumer = consumer)
        assertEquals(RuntimeCustodyOutcome.BLOCKED, orchestrator.syncNow())
        assertEquals(0, effectCalls)
        assertTrue(relay.acknowledgedMessageIds.isEmpty())
        assertEquals(originals, journal.records())
        assertEquals(1, inbox.pendingAcknowledgements(scope).size)
        assertTrue(orchestrator.connectionState.value != SyncConnectionState.LIVE)
    }

    @Test fun `retained application recovers before failed ACK without repeating effect`() = runTest {
        val store = InMemoryPersistentStateStore()
        val inbox = PersistentCiphertextInbox(store, "device-1")
        val journal = PersistentInboundApplicationJournal(store, "device-1")
        val scope = RuntimeInboxScope("family-1", "device-1")
        val wire = inbound("retained-effect").envelopeWire!!
        inbox.capture(scope, listOf(wire))
        val intent = InboundApplicationIntent("00000000-0000-0000-0000-000000000001", scope,
            "retained-effect", wire, "AQ==", "Ag==", 1_700_000_001_000L)
        journal.prepare(intent)
        var reconciled = false
        var applied = false
        val consumer = VerifiedInboundCommandConsumer(journal,
            InboundCommandVerifier { _, _ -> InboundVerificationResult.Accepted("AQ==", "Ag==") {} },
            object : InboundCommandApplier {
                override suspend fun reconcile(intent: InboundApplicationIntent): InboundEffectRecovery {
                    reconciled = true
                    return InboundEffectRecovery.Completed(InboundApplicationOutcome.APPLIED)
                }
                override suspend fun apply(intent: InboundApplicationIntent, assertAuthority: () -> Unit): InboundApplicationOutcome {
                    applied = true; error("Recovery must not repeat effect")
                }
            }, { 1_700_000_061_000L })
        var ackCalls = 0
        val transport = object : org.pca.app.runtime.sync.transport.RelayHttpClient by FakeRelayHttpClient() {
            override suspend fun acknowledgeInbound(sessionToken: String, messageId: String) {
                ackCalls++
                assertTrue(reconciled)
                assertEquals(InboundApplicationOutcome.APPLIED, journal.records().single().outcome)
                throw org.pca.app.runtime.sync.transport.RelayHttpException(
                    org.pca.app.runtime.sync.transport.RelayHttpErrorCode.Network, "offline")
            }
        }
        val orchestrator = buildOrchestrator(FakeDurableBackingStore(), transport, inbox = inbox, consumer = consumer)
        assertEquals(RuntimeCustodyOutcome.RETRYABLE_FAILURE, orchestrator.syncNow())
        assertEquals(1, ackCalls)
        assertTrue(!applied)
        assertEquals(intent.operationId, journal.records().single().intent.operationId)
        assertEquals(1, inbox.pendingAcknowledgements(scope).size)
        assertEquals(1, inbox.pendingCrypto(scope).size)
    }

    @Test fun `rejected session is reauthenticated on the next attempt`() = runTest {
        val relay = FakeRelayHttpClient()
        var authentications = 0
        var pulls = 0
        val transport = object : org.pca.app.runtime.sync.transport.RelayHttpClient by relay {
            override suspend fun completeChallenge(deviceId: String, challengeId: String, signature: String): org.pca.app.runtime.sync.transport.DeviceSessionInfo {
                authentications++
                return relay.completeChallenge(deviceId, challengeId, signature).copy(sessionToken = "session-$authentications")
            }
            override suspend fun listInbound(sessionToken: String, cursor: String?): org.pca.app.runtime.sync.transport.InboundListResult {
                if (++pulls == 1) throw org.pca.app.runtime.sync.transport.RelayHttpException(
                    org.pca.app.runtime.sync.transport.RelayHttpErrorCode.Unauthorized, "rejected")
                assertEquals("session-2", sessionToken)
                return relay.listInbound(sessionToken, cursor)
            }
        }
        val orchestrator = buildOrchestrator(FakeDurableBackingStore(), transport)
        assertEquals(RuntimeCustodyOutcome.RETRYABLE_FAILURE, orchestrator.syncNow())
        assertEquals(RuntimeCustodyOutcome.COMPLETE, orchestrator.syncNow())
        assertEquals(2, authentications)
    }

    @Test fun `rejected saved cursor starts one fresh bounded sweep without losing ciphertext`() = runTest {
        val relay = FakeRelayHttpClient()
        val inbox = PersistentCiphertextInbox(InMemoryPersistentStateStore(), "device-1")
        val incarnation = java.security.MessageDigest.getInstance("SHA-256")
            .digest("session-for-device-1".toByteArray()).joinToString("") { "%02x".format(it.toInt() and 255) }
        inbox.capture(RuntimeInboxScope("family-1", "device-1"), listOf(inbound("retained").envelopeWire!!),
            navigation = org.pca.app.runtime.sync.transport.InboundNavigation("oldCursor", true, false, incarnation),
            expectedSessionIncarnation = incarnation)
        val cursors = mutableListOf<String?>()
        val transport = object : org.pca.app.runtime.sync.transport.RelayHttpClient by relay {
            override suspend fun listInbound(sessionToken: String, cursor: String?): org.pca.app.runtime.sync.transport.InboundListResult {
                cursors.add(cursor)
                if (cursor != null) throw org.pca.app.runtime.sync.transport.RelayHttpException(
                    org.pca.app.runtime.sync.transport.RelayHttpErrorCode.InvalidCursor, "expired")
                return relay.listInbound(sessionToken, cursor).copy(navigation =
                    org.pca.app.runtime.sync.transport.InboundNavigation(null, false, false, incarnation))
            }
        }
        val orchestrator = buildOrchestrator(FakeDurableBackingStore(), transport, inbox = inbox)
        assertEquals(RuntimeCustodyOutcome.COMPLETE, orchestrator.syncNow())
        assertEquals(listOf("oldCursor", null), cursors)
        assertEquals(1, inbox.pendingCryptoCount())
        assertEquals(listOf("retained"), relay.acknowledgedMessageIds)
    }

    @Test fun `ordinary invalid request does not reset stored navigation`() = runTest {
        val relay = FakeRelayHttpClient()
        val inbox = PersistentCiphertextInbox(InMemoryPersistentStateStore(), "device-1")
        val incarnation = java.security.MessageDigest.getInstance("SHA-256")
            .digest("session-for-device-1".toByteArray()).joinToString("") { "%02x".format(it.toInt() and 255) }
        inbox.capture(RuntimeInboxScope("family-1", "device-1"), emptyList(),
            navigation = org.pca.app.runtime.sync.transport.InboundNavigation("savedCursor", true, false, incarnation),
            expectedSessionIncarnation = incarnation)
        var pulls = 0
        val transport = object : org.pca.app.runtime.sync.transport.RelayHttpClient by relay {
            override suspend fun listInbound(sessionToken: String, cursor: String?): org.pca.app.runtime.sync.transport.InboundListResult {
                pulls++
                throw org.pca.app.runtime.sync.transport.RelayHttpException(
                    org.pca.app.runtime.sync.transport.RelayHttpErrorCode.InvalidRequest, "malformed")
            }
        }
        assertEquals(RuntimeCustodyOutcome.BLOCKED,
            buildOrchestrator(FakeDurableBackingStore(), transport, inbox = inbox).syncNow())
        assertEquals(1, pulls)
        assertEquals("savedCursor", inbox.navigationFor(incarnation)?.nextCursor)
    }

    @Test fun `transport failure requests retry while custody failure is blocked`() = runTest {
        val failedRelay = FakeRelayHttpClient().apply { failNextList = true }
        assertEquals(RuntimeCustodyOutcome.RETRYABLE_FAILURE,
            buildOrchestrator(FakeDurableBackingStore(), failedRelay).syncNow())
        val relay = FakeRelayHttpClient()
        assertEquals(RuntimeCustodyOutcome.BLOCKED,
            buildOrchestrator(FakeDurableBackingStore(), relay, assertKeyCustody = { error("key unavailable") }).syncNow())
        assertEquals(0, relay.inboundListCalls)
    }

    @Test fun `terminal custody completes scheduling while ciphertext still awaits crypto`() = runTest {
        val relay = FakeRelayHttpClient().apply { enqueueInbound(inbound("pending-crypto")) }
        val inbox = PersistentCiphertextInbox(InMemoryPersistentStateStore(), "device-1")
        val orchestrator = buildOrchestrator(FakeDurableBackingStore(), relay, inbox = inbox)
        assertEquals(RuntimeCustodyOutcome.COMPLETE, orchestrator.syncNow())
        assertEquals(1, inbox.pendingCryptoCount())
        assertEquals(SyncConnectionState.SYNC_PENDING, orchestrator.connectionState.value)
    }

    @Test fun `bounded modern campaign resumes durable cursor on next invocation`() = runTest {
        val backing = InMemoryPersistentStateStore()
        val inbox = PersistentCiphertextInbox(backing, "device-1")
        val relay = FakeRelayHttpClient()
        val incarnation = java.security.MessageDigest.getInstance("SHA-256")
            .digest("session-for-device-1".toByteArray()).joinToString("") { "%02x".format(it.toInt() and 255) }
        val cursors = mutableListOf<String?>()
        val modern = object : org.pca.app.runtime.sync.transport.RelayHttpClient by relay {
            override suspend fun listInbound(sessionToken: String, cursor: String?): org.pca.app.runtime.sync.transport.InboundListResult {
                cursors.add(cursor)
                val page = cursors.size
                val more = page < 5
                return org.pca.app.runtime.sync.transport.InboundListResult(emptyList(), emptyList(), emptyList(),
                    RuntimeInboxScope("family-1", "device-1"), more,
                    navigation = org.pca.app.runtime.sync.transport.InboundNavigation(
                        if (more) "cursor$page" else null, more, false, incarnation))
            }
        }
        val first = buildOrchestrator(FakeDurableBackingStore(), modern, inbox = inbox)
        assertEquals(RuntimeCustodyOutcome.MORE_PENDING, first.syncNow())
        assertEquals(listOf(null, "cursor1", "cursor2", "cursor3"), cursors)
        val restored = PersistentCiphertextInbox(backing, "device-1")
        val second = buildOrchestrator(FakeDurableBackingStore(), modern, inbox = restored)
        assertEquals(RuntimeCustodyOutcome.COMPLETE, second.syncNow())
        assertEquals("cursor4", cursors.last())
        assertEquals(null, restored.navigationFor(incarnation)?.nextCursor)
    }

    @Test fun `retained old family ciphertext is not acknowledged under a new root`() = runTest {
        val relay = FakeRelayHttpClient()
        val inbox = PersistentCiphertextInbox(InMemoryPersistentStateStore(), "device-1")
        inbox.capture(RuntimeInboxScope("family-1", "device-1"), listOf(inbound("old-family").envelopeWire!!))
        val orchestrator = buildOrchestrator(FakeDurableBackingStore(), relay, inbox = inbox,
            expectedFamilyId = "family-2")

        orchestrator.syncNow()

        assertTrue(relay.acknowledgedMessageIds.isEmpty())
        assertEquals(0, relay.inboundListCalls)
        assertEquals(1, inbox.pendingAcknowledgements(RuntimeInboxScope("family-1", "device-1")).size)
        assertTrue(orchestrator.connectionState.value != SyncConnectionState.LIVE)
    }

    @Test fun `server continuation keeps empty inbound page pending without paging or acknowledgement`() = runTest {
        val relay = FakeRelayHttpClient().apply { inboundHasMore = true }
        val orchestrator = buildOrchestrator(FakeDurableBackingStore(), relay)

        orchestrator.syncNow()

        assertEquals(SyncConnectionState.SYNC_PENDING, orchestrator.connectionState.value)
        assertEquals(1, relay.inboundListCalls)
        assertTrue(relay.acknowledgedMessageIds.isEmpty())

        relay.inboundHasMore = false
        orchestrator.syncNow()

        assertEquals(SyncConnectionState.LIVE, orchestrator.connectionState.value)
        assertEquals(2, relay.inboundListCalls)
    }

    @Test fun `failed pull after observed continuation keeps relay work pending`() = runTest {
        val relay = FakeRelayHttpClient().apply { inboundHasMore = true }
        val orchestrator = buildOrchestrator(FakeDurableBackingStore(), relay)

        orchestrator.syncNow()
        assertEquals(SyncConnectionState.SYNC_PENDING, orchestrator.connectionState.value)

        relay.inboundHasMore = false
        relay.failNextList = true
        orchestrator.syncNow()

        assertEquals(SyncConnectionState.SYNC_PENDING, orchestrator.connectionState.value)
        assertEquals(2, relay.inboundListCalls)
        assertTrue(relay.acknowledgedMessageIds.isEmpty())
    }

    @Test fun `key loss after pull prevents capture and leaves relay ciphertext unacknowledged`() = runTest {
        val relay = FakeRelayHttpClient()
        relay.enqueueInbound(inbound("message-1"))
        var keyAvailable = true
        val lostKey = object : org.pca.app.runtime.sync.transport.RelayHttpClient by relay {
            override suspend fun listInbound(sessionToken: String, cursor: String?) = relay.listInbound(sessionToken).also { keyAvailable = false }
        }
        val inbox = PersistentCiphertextInbox(InMemoryPersistentStateStore(), "device-1")
        val orchestrator = buildOrchestrator(FakeDurableBackingStore(), lostKey, inbox = inbox,
            assertKeyCustody = { check(keyAvailable) })
        orchestrator.syncNow()
        assertTrue(relay.acknowledgedMessageIds.isEmpty())
        assertEquals(0, inbox.pendingCryptoCount())
        assertTrue(orchestrator.connectionState.value != SyncConnectionState.LIVE)
    }

    @Test fun `stored pending acknowledgement is recovered before a failed new pull`() = runTest {
        val relay = FakeRelayHttpClient().apply { failNextList = true }
        val inbox = PersistentCiphertextInbox(InMemoryPersistentStateStore(), "device-1")
        val retained = inbound("previously-captured")
        inbox.capture(RuntimeInboxScope("family-1", "device-1"), listOf(retained.envelopeWire!!))
        val orchestrator = buildOrchestrator(FakeDurableBackingStore(), relay, inbox = inbox)
        orchestrator.syncNow()
        assertEquals(listOf("previously-captured"), relay.acknowledgedMessageIds)
        assertTrue(inbox.pendingAcknowledgements(RuntimeInboxScope("family-1", "device-1")).isEmpty())
        assertEquals(1, inbox.pendingCryptoCount())
        assertTrue(orchestrator.connectionState.value != SyncConnectionState.LIVE)
    }

    @Test fun `uncaptured relay ids remain pending and never report LIVE`() = runTest {
        val relay = FakeRelayHttpClient()
        val incomplete = object : org.pca.app.runtime.sync.transport.RelayHttpClient by relay {
            override suspend fun listInbound(sessionToken: String, cursor: String?) = org.pca.app.runtime.sync.transport.InboundListResult(
                emptyList(), listOf("malformed-1"), listOf("overflow-1"), RuntimeInboxScope("family-1", "device-1"))
        }
        val orchestrator = buildOrchestrator(FakeDurableBackingStore(), incomplete)
        orchestrator.syncNow()
        assertTrue(orchestrator.connectionState.value != SyncConnectionState.LIVE)
        assertTrue(relay.acknowledgedMessageIds.isEmpty())
    }

    @Test fun `overlapping reconnects serialize custody and acknowledge once`() = runTest {
        val relay = FakeRelayHttpClient()
        relay.enqueueInbound(inbound("message-1"))
        var active = 0
        var maximum = 0
        val delayed = object : org.pca.app.runtime.sync.transport.RelayHttpClient by relay {
            override suspend fun listInbound(sessionToken: String, cursor: String?): org.pca.app.runtime.sync.transport.InboundListResult {
                active++
                maximum = maxOf(maximum, active)
                delay(10)
                return relay.listInbound(sessionToken).also { active-- }
            }
        }
        val orchestrator = buildOrchestrator(FakeDurableBackingStore(), delayed)
        val first = async { orchestrator.syncNow() }
        val second = async { orchestrator.syncNow() }
        first.await(); second.await()
        assertEquals(1, maximum)
        assertEquals(listOf("message-1"), relay.acknowledgedMessageIds)
    }

    @Test
    fun `ack failure retries after restart without invoking unverified handler`() = runTest {
        val relay = FakeRelayHttpClient()
        val backing = InMemoryPersistentStateStore()
        val inbox = PersistentCiphertextInbox(backing, "device-1")
        val handler = RecordingInboundHandler()
        val orchestrator = buildOrchestrator(FakeDurableBackingStore(), relay, handler, inbox = inbox)
        relay.enqueueInbound(inbound("retry-1"))
        relay.failNextAck = true
        orchestrator.syncNow()
        assertTrue(orchestrator.connectionState.value != SyncConnectionState.LIVE)
        assertEquals(1, inbox.pendingAcknowledgements(RuntimeInboxScope("family-1", "device-1")).size)
        val restored = PersistentCiphertextInbox(backing, "device-1")
        buildOrchestrator(FakeDurableBackingStore(), relay, handler, inbox = restored).syncNow()
        assertEquals(listOf("retry-1"), relay.acknowledgedMessageIds)
        assertTrue(handler.handled.isEmpty())
        assertEquals(1, restored.pendingCrypto(RuntimeInboxScope("family-1", "device-1")).size)
    }

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
        val realOrchestrator = ReconnectSyncOrchestrator(FakeConnectivitySource(), sessionManager, relay, outbox, RecordingInboundHandler(), nowEpochMillis = { time }, expectedFamilyId = "family-1")

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
    fun `flapping reconnect acknowledges custody once and never dispatches unverified payload`() = runTest {
        val store = FakeDurableBackingStore()
        val relay = FakeRelayHttpClient()
        val handler = RecordingInboundHandler()
        val orchestrator = buildOrchestrator(store, relay, handler)

        relay.enqueueInbound(inbound("msg-1"))

        // online / offline / online / offline / online -- flap several times.
        repeat(5) { orchestrator.syncNow() }

        assertEquals(listOf("msg-1"), relay.acknowledgedMessageIds)
        assertTrue(handler.handled.isEmpty())
    }

    @Test
    fun `two distinct ciphertexts across reconnects are acknowledged in order`() = runTest {
        val store = FakeDurableBackingStore()
        val relay = FakeRelayHttpClient()
        val handler = RecordingInboundHandler()
        val orchestrator = buildOrchestrator(store, relay, handler)

        relay.enqueueInbound(inbound("msg-1"))
        orchestrator.syncNow()
        relay.enqueueInbound(inbound("msg-2"))
        orchestrator.syncNow()

        assertEquals(listOf("msg-1", "msg-2"), relay.acknowledgedMessageIds)
        assertTrue(handler.handled.isEmpty())
    }

    // ---- connection state honesty ----

    @Test
    fun `failed later pull never hides pending crypto behind LIVE`() = runTest {
        val relay = FakeRelayHttpClient()
        val backing = InMemoryPersistentStateStore()
        val inbox = PersistentCiphertextInbox(backing, "device-1")
        val orchestrator = buildOrchestrator(FakeDurableBackingStore(), relay, inbox = inbox)
        relay.enqueueInbound(inbound("message-1"))
        orchestrator.syncNow()
        assertTrue(orchestrator.connectionState.value != SyncConnectionState.LIVE)
        relay.failNextList = true
        orchestrator.syncNow()
        assertTrue(orchestrator.connectionState.value != SyncConnectionState.LIVE)
        assertEquals(1, inbox.pendingCryptoCount())
        val restored = buildOrchestrator(FakeDurableBackingStore(), relay,
            inbox = PersistentCiphertextInbox(backing, "device-1"))
        relay.failNextList = true
        restored.syncNow()
        assertTrue(restored.connectionState.value != SyncConnectionState.LIVE)
    }

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
