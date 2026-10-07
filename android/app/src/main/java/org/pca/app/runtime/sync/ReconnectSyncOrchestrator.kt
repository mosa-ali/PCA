package org.pca.app.runtime.sync

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.pca.app.runtime.sync.inbox.PersistentCiphertextInbox
import org.pca.app.runtime.sync.backoff.computeBackoff
import org.pca.app.runtime.sync.connectivity.ConnectivitySignal
import org.pca.app.runtime.sync.connectivity.ConnectivitySource
import org.pca.app.runtime.sync.outbox.SyncOutboxPort
import org.pca.app.runtime.sync.state.ComputeConnectionStateInput
import org.pca.app.runtime.sync.state.SyncConnectionState
import org.pca.app.runtime.sync.state.computeSyncConnectionState
import org.pca.app.runtime.sync.transport.OutboundSubmitItem
import org.pca.app.runtime.sync.transport.RelayHttpClient
import org.pca.app.runtime.sync.transport.RelayHttpException
import org.pca.app.runtime.sync.transport.RelayHttpErrorCode

/** Scheduling result only. Completion proves transport custody, never crypto or enforcement. */
enum class RuntimeCustodyOutcome { COMPLETE, MORE_PENDING, RETRYABLE_FAILURE, BLOCKED, INELIGIBLE }

/** Legacy callback retained for constructor compatibility; the custody path never dispatches through it. */
interface InboundEnvelopeHandler {
    suspend fun handle(messageId: String, senderDeviceId: String, messageType: String, payloadBase64: String)
}

/**
 * PCA-16's Android reconnect orchestrator (doc 40 Sections 5/6/9/10/14/15/17):
 * composes ConnectivitySource (trigger only, never itself LIVE),
 * DeviceSessionManager (auth), RelayHttpClient (transport), SyncOutboxPort
 * (Agent-12's durable queue, via its own abstraction), and
 * BackoffPolicy/SyncPolicy's bounded-batch constants into one bounded
 * reconnect-drain cycle for both directions.
 *
 * KNOWN GAP, documented (see SyncOutboxPort's own doc comment): outbound
 * batch-slot priority ordering by message-type tier is not wired here
 * because the real outbox has no message-type column; delivery order
 * follows `SyncOutboxDao.getReadyForDelivery`'s own `sequence` ordering
 * instead. Complete signed inbound wrappers are retained in a durable inbox
 * before explicit relay acknowledgement. They remain pending crypto; this
 * transport never invokes the legacy lossy handler or claims OS enforcement.
 * Missing durable storage fails closed and cannot produce a successful sync.
 */
class ReconnectSyncOrchestrator(
    private val connectivitySource: ConnectivitySource,
    private val sessionManager: DeviceSessionManager,
    private val relayHttpClient: RelayHttpClient,
    private val outboxPort: SyncOutboxPort,
    private val inboundHandler: InboundEnvelopeHandler,
    private val nowEpochMillis: () -> Long = { System.currentTimeMillis() },
    private val ciphertextInbox: PersistentCiphertextInbox? = null,
    /** Production binds family to the captured committed root, independently of a response. */
    private val expectedFamilyId: String,
    private val inboundConsumer: org.pca.app.runtime.sync.inbox.VerifiedInboundCommandConsumer? = null,
) {
    init { require(expectedFamilyId.isNotBlank() && expectedFamilyId.length <= 128) }
    private val reconnectMutex = Mutex()
    private val _connectionState = MutableStateFlow(SyncConnectionState.OFFLINE)
    val connectionState: StateFlow<SyncConnectionState> = _connectionState.asStateFlow()

    private var isTransportConnected = false
    private var isSyncing = false
    private var lastSuccessfulSyncAtEpochMillis: Long? = null
    private var pendingLocalWorkCount = 0
    private var pendingRelayWorkCount = 0

    /** Starts observing connectivity and attempting a reconnect on every transition to AVAILABLE. Caller owns the CoroutineScope's lifecycle. */
    fun start(scope: CoroutineScope) {
        scope.launch {
            connectivitySource.observe().collect { signal ->
                isTransportConnected = signal == ConnectivitySignal.AVAILABLE
                publishState()
                if (signal == ConnectivitySignal.AVAILABLE) attemptReconnect()
            }
        }
    }

    /**
     * A "sync now" entrypoint independent of the connectivity flow above
     * (e.g. a manual pull-to-refresh, or a test driving reconnect attempts
     * directly without running the connectivity collector). Marks the
     * transport connected for the duration of this attempt -- callers that
     * invoke this directly are asserting connectivity is currently usable.
     */
    suspend fun syncNow(): RuntimeCustodyOutcome {
        isTransportConnected = true
        return attemptReconnect()
    }

    private fun publishState() {
        _connectionState.value = computeSyncConnectionState(
            ComputeConnectionStateInput(
                isTransportConnected = isTransportConnected,
                isSyncing = isSyncing,
                hasPendingLocalWork = pendingLocalWorkCount > 0 || pendingRelayWorkCount > 0 ||
                    (ciphertextInbox?.let { inbox ->
                        runCatching {
                            val consumer = inboundConsumer
                            if (consumer == null) inbox.pendingCryptoCount() > 0 else {
                                val scope = inbox.retainedScope()
                                if (scope == null) false else {
                                    if (scope.familyId != expectedFamilyId || scope.recipientDeviceId != sessionManager.configuredDeviceId)
                                        throw IllegalStateException("Stored application scope changed")
                                    inbox.pendingAcknowledgements(scope).isNotEmpty() ||
                                        consumer.pending(inbox.pendingCrypto(scope), scope).isNotEmpty()
                                }
                            }
                        }.getOrDefault(true)
                    } ?: true),
                lastSuccessfulSyncAtEpochMillis = lastSuccessfulSyncAtEpochMillis,
                nowEpochMillis = nowEpochMillis(),
            ),
        )
    }

    /** One bounded reconnect attempt: outbound drain, then inbound drain. Safe to call repeatedly (e.g. on every connectivity flap) -- every step below is itself idempotent/bounded. */
    suspend fun attemptReconnect(): RuntimeCustodyOutcome = reconnectMutex.withLock {
        if (!isTransportConnected) return@withLock RuntimeCustodyOutcome.RETRYABLE_FAILURE
        isSyncing = true
        publishState()
        try {
            val sessionToken = try {
                sessionManager.requireSessionToken()
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                lastSuccessfulSyncAtEpochMillis = null
                return@withLock failureOutcome(error)
            }
            val outboundReached = drainOutbound(sessionToken)
            if (outboundReached == RuntimeCustodyOutcome.BLOCKED) return@withLock outboundReached
            val inboundReached = drainInbound(sessionToken)
            // A "successful sync" requires BOTH directions to have
            // genuinely reached the server this attempt (an empty
            // direction with nothing to send/receive counts as vacuously
            // reached) -- a transport-level failure on EITHER direction
            // must never be papered over by the other direction happening
            // to have nothing to do, or computeSyncConnectionState could
            // claim LIVE off a sync that only partially happened.
            if (outboundReached == RuntimeCustodyOutcome.COMPLETE && (inboundReached == RuntimeCustodyOutcome.COMPLETE || inboundReached == RuntimeCustodyOutcome.MORE_PENDING)) {
                lastSuccessfulSyncAtEpochMillis = nowEpochMillis()
            }
            if (inboundReached == RuntimeCustodyOutcome.BLOCKED) return@withLock inboundReached
            if (outboundReached == RuntimeCustodyOutcome.RETRYABLE_FAILURE || inboundReached == RuntimeCustodyOutcome.RETRYABLE_FAILURE) {
                return@withLock RuntimeCustodyOutcome.RETRYABLE_FAILURE
            }
            currentCoroutineContext().ensureActive()
            sessionManager.assertCurrentSession(sessionToken)
            pendingLocalWorkCount = outboxPort.getReadyForDelivery(nowEpochMillis()).size
            currentCoroutineContext().ensureActive()
            sessionManager.assertCurrentSession(sessionToken)
            if (pendingLocalWorkCount > 0 || inboundReached == RuntimeCustodyOutcome.MORE_PENDING)
                RuntimeCustodyOutcome.MORE_PENDING else RuntimeCustodyOutcome.COMPLETE
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            failureOutcome(error)
        } finally {
            isSyncing = false
            publishState()
        }
    }

    private fun failureOutcome(error: Exception): RuntimeCustodyOutcome =
        if (error is DeviceSessionChanged || (error is RelayHttpException && (error.errorCode == RelayHttpErrorCode.Network ||
                error.errorCode == RelayHttpErrorCode.Unknown || error.errorCode == RelayHttpErrorCode.Unauthorized))
            )
            RuntimeCustodyOutcome.RETRYABLE_FAILURE else RuntimeCustodyOutcome.BLOCKED

    /** Returns true if this attempt genuinely reached the server (including "nothing to send"), false only on a total transport-level failure. */
    private suspend fun drainOutbound(sessionToken: String): RuntimeCustodyOutcome {
        val now = nowEpochMillis()
        outboxPort.deleteExpired(now)
        currentCoroutineContext().ensureActive()
        sessionManager.assertCurrentSession(sessionToken)
        val ready = outboxPort.getReadyForDelivery(now).take(MAX_OUTBOUND_BATCH_SIZE)
        pendingLocalWorkCount = ready.size
        currentCoroutineContext().ensureActive()
        sessionManager.assertCurrentSession(sessionToken)
        if (ready.isEmpty()) return RuntimeCustodyOutcome.COMPLETE

        val items = ready.mapIndexed { index, item ->
            OutboundSubmitItem(
                messageId = item.messageId,
                recipientDeviceId = item.recipientScope,
                ciphertextBase64 = item.envelopeCiphertextBase64,
                // See this file's class doc: the real outbox has no
                // message-type column, so batch-slot priority tiering
                // cannot be driven per-item here; the server-side priority
                // sorter falls back to its own default (lowest) tier for
                // every item from this path, which is safe (never a
                // security property) just not prioritized. `index` preserves
                // this batch's already-`sequence`-ordered relative order as
                // the priority tie-break.
                messageType = "ACTIVITY_SUMMARY",
                enqueuedAtEpochMillis = now + index,
            )
        }

        return try {
            val result = relayHttpClient.submitOutbound(sessionToken, items)
            currentCoroutineContext().ensureActive()
            sessionManager.assertCurrentSession(sessionToken)
            val outcomeByMessageId = result.results.associateBy { it.messageId }
            for (item in ready) {
                currentCoroutineContext().ensureActive()
                sessionManager.assertCurrentSession(sessionToken)
                when (outcomeByMessageId[item.messageId]?.outcome) {
                    "QUEUED" -> outboxPort.markSent(item.messageId)
                    "CONFLICT", "INVALID" -> outboxPort.markSent(item.messageId) // permanent failure -- retrying cannot succeed
                    else -> Unit // dropped-for-batch-bound or missing -- left PENDING, retried next attempt
                }
            }
            RuntimeCustodyOutcome.COMPLETE
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            if (failureOutcome(error) == RuntimeCustodyOutcome.BLOCKED) return RuntimeCustodyOutcome.BLOCKED
            if (error is RelayHttpException && error.errorCode == RelayHttpErrorCode.Unauthorized)
                sessionManager.invalidateRejectedSession(sessionToken)
            if (error is DeviceSessionChanged || (error is RelayHttpException && error.errorCode == RelayHttpErrorCode.Unauthorized))
                return RuntimeCustodyOutcome.RETRYABLE_FAILURE
            for (item in ready) {
                currentCoroutineContext().ensureActive()
                sessionManager.assertCurrentSession(sessionToken)
                val decision = computeBackoff(item.retryCount, now)
                if (decision.shouldRetry) {
                    outboxPort.markFailedForRetry(item.messageId, decision.nextRetryAtEpochMillis)
                } else {
                    outboxPort.markSent(item.messageId) // exhausted retries -- explicit give-up, never retried forever
                }
            }
            RuntimeCustodyOutcome.RETRYABLE_FAILURE
        }
    }

    /** Retained crypto work alone does not request immediate scheduler retries. */
    private suspend fun drainInbound(sessionToken: String): RuntimeCustodyOutcome {
        val inbox = ciphertextInbox ?: return RuntimeCustodyOutcome.BLOCKED
        val incarnation = java.security.MessageDigest.getInstance("SHA-256")
            .digest(sessionToken.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it.toInt() and 255) }
        val started = System.nanoTime()
        return try {
            var cursor = inbox.navigationFor(incarnation)?.nextCursor
            var resetRejectedCursor = false
            var ackCount = 0
            suspend fun consumeStored(scope: org.pca.app.runtime.sync.inbox.RuntimeInboxScope) {
                if (scope.recipientDeviceId != sessionManager.configuredDeviceId || scope.familyId != expectedFamilyId)
                    throw IllegalStateException("Stored application scope changed")
                val consumer = inboundConsumer ?: return
                val context = currentCoroutineContext()
                fun assertContinuity() {
                    context.ensureActive()
                    sessionManager.assertCurrentSession(sessionToken)
                    if (System.nanoTime() - started >= 30_000_000_000L) throw IllegalStateException("Application campaign expired")
                }
                assertContinuity()
                consumer.consume(inbox.pendingCrypto(scope), scope, ::assertContinuity)
                assertContinuity()
            }
            suspend fun acknowledgeStored(scope: org.pca.app.runtime.sync.inbox.RuntimeInboxScope): Boolean {
                if (scope.recipientDeviceId != sessionManager.configuredDeviceId
                    || scope.familyId != expectedFamilyId) {
                    throw IllegalStateException("Stored relay scope changed")
                }
                for (record in inbox.pendingAcknowledgements(scope)) {
                    currentCoroutineContext().ensureActive()
                    sessionManager.assertCurrentSession(sessionToken)
                    if (ackCount >= 100 || System.nanoTime() - started >= 30_000_000_000L) return false
                    relayHttpClient.acknowledgeInbound(sessionToken, record.messageId)
                    currentCoroutineContext().ensureActive()
                    sessionManager.assertCurrentSession(sessionToken)
                    inbox.markAcknowledged(scope, record.messageId, record.envelopeWire)
                    ackCount++
                }
                return true
            }
            // Recovery must not depend on a successful subsequent page fetch.
            // The same stored scope and current device session remain required.
            inbox.retainedScope()?.let {
                consumeStored(it)
                if (!acknowledgeStored(it)) return RuntimeCustodyOutcome.MORE_PENDING
            }
            for (page in 0 until 4) {
                currentCoroutineContext().ensureActive()
                sessionManager.assertCurrentSession(sessionToken)
                if (System.nanoTime() - started >= 30_000_000_000L) return RuntimeCustodyOutcome.MORE_PENDING
                val result = try {
                    relayHttpClient.listInbound(sessionToken, cursor)
                } catch (error: RelayHttpException) {
                    currentCoroutineContext().ensureActive()
                    sessionManager.assertCurrentSession(sessionToken)
                    val rejected = cursor
                    if (error.errorCode != RelayHttpErrorCode.InvalidCursor || rejected == null || resetRejectedCursor) throw error
                    inbox.resetRejectedNavigation(incarnation, rejected)
                    cursor = null
                    resetRejectedCursor = true
                    continue
                }
                currentCoroutineContext().ensureActive()
                sessionManager.assertCurrentSession(sessionToken)
                val scope = result.scope ?: return RuntimeCustodyOutcome.BLOCKED
                if (scope.recipientDeviceId != sessionManager.configuredDeviceId) return RuntimeCustodyOutcome.BLOCKED
                if (scope.familyId != expectedFamilyId) return RuntimeCustodyOutcome.BLOCKED
                val navigation = result.navigation
                if (navigation != null && navigation.sessionIncarnation != incarnation) return RuntimeCustodyOutcome.BLOCKED
                inbox.capture(scope, result.applied.map { it.envelopeWire ?: throw IllegalStateException("Missing envelope") },
                    result.receipts, navigation, incarnation, cursor)
                consumeStored(scope)
                pendingRelayWorkCount = result.unparseableMessageIds.size +
                    (if (result.hasMore || inbox.hasUnresolvedRelayWork()) 1 else 0)
                // ACK recovery is independent of which wrappers appeared on this page.
                if (!acknowledgeStored(scope)) return RuntimeCustodyOutcome.MORE_PENDING
                if (navigation == null || !navigation.hasMore) return RuntimeCustodyOutcome.COMPLETE
                val next = navigation.nextCursor ?: return RuntimeCustodyOutcome.BLOCKED
                if (next == cursor) return RuntimeCustodyOutcome.BLOCKED
                cursor = next
            }
            RuntimeCustodyOutcome.MORE_PENDING
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            if (error is RelayHttpException && error.errorCode == RelayHttpErrorCode.Unauthorized)
                sessionManager.invalidateRejectedSession(sessionToken)
            failureOutcome(error)
        }
    }
}
