package org.pca.app.runtime.sync

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
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
) {
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
    suspend fun syncNow() {
        isTransportConnected = true
        attemptReconnect()
    }

    private fun publishState() {
        _connectionState.value = computeSyncConnectionState(
            ComputeConnectionStateInput(
                isTransportConnected = isTransportConnected,
                isSyncing = isSyncing,
                hasPendingLocalWork = pendingLocalWorkCount > 0 || pendingRelayWorkCount > 0 ||
                    (ciphertextInbox?.let { runCatching { it.pendingCryptoCount() > 0 }.getOrDefault(true) } ?: true),
                lastSuccessfulSyncAtEpochMillis = lastSuccessfulSyncAtEpochMillis,
                nowEpochMillis = nowEpochMillis(),
            ),
        )
    }

    /** One bounded reconnect attempt: outbound drain, then inbound drain. Safe to call repeatedly (e.g. on every connectivity flap) -- every step below is itself idempotent/bounded. */
    suspend fun attemptReconnect() = reconnectMutex.withLock {
        if (!isTransportConnected) return@withLock
        isSyncing = true
        publishState()
        try {
            val sessionToken = try {
                sessionManager.requireSessionToken()
            } catch (_: Exception) {
                lastSuccessfulSyncAtEpochMillis = null
                return@withLock // authentication failed -- next trigger retries.
            }
            val outboundReached = drainOutbound(sessionToken)
            val inboundReached = drainInbound(sessionToken)
            // A "successful sync" requires BOTH directions to have
            // genuinely reached the server this attempt (an empty
            // direction with nothing to send/receive counts as vacuously
            // reached) -- a transport-level failure on EITHER direction
            // must never be papered over by the other direction happening
            // to have nothing to do, or computeSyncConnectionState could
            // claim LIVE off a sync that only partially happened.
            if (outboundReached && inboundReached) {
                lastSuccessfulSyncAtEpochMillis = nowEpochMillis()
            }
        } finally {
            isSyncing = false
            publishState()
        }
    }

    /** Returns true if this attempt genuinely reached the server (including "nothing to send"), false only on a total transport-level failure. */
    private suspend fun drainOutbound(sessionToken: String): Boolean {
        val now = nowEpochMillis()
        outboxPort.deleteExpired(now)
        val ready = outboxPort.getReadyForDelivery(now).take(MAX_OUTBOUND_BATCH_SIZE)
        pendingLocalWorkCount = ready.size
        if (ready.isEmpty()) return true

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
            val outcomeByMessageId = result.results.associateBy { it.messageId }
            for (item in ready) {
                when (outcomeByMessageId[item.messageId]?.outcome) {
                    "QUEUED" -> outboxPort.markSent(item.messageId)
                    "CONFLICT", "INVALID" -> outboxPort.markSent(item.messageId) // permanent failure -- retrying cannot succeed
                    else -> Unit // dropped-for-batch-bound or missing -- left PENDING, retried next attempt
                }
            }
            true
        } catch (_: Exception) {
            for (item in ready) {
                val decision = computeBackoff(item.retryCount, now)
                if (decision.shouldRetry) {
                    outboxPort.markFailedForRetry(item.messageId, decision.nextRetryAtEpochMillis)
                } else {
                    outboxPort.markSent(item.messageId) // exhausted retries -- explicit give-up, never retried forever
                }
            }
            false
        }
    }

    /** Returns true if this attempt genuinely reached the server, false only on a total transport-level failure. */
    private suspend fun drainInbound(sessionToken: String): Boolean {
        val result = try {
            relayHttpClient.listInbound(sessionToken)
        } catch (_: Exception) {
            return false
        }
        val inbox = ciphertextInbox ?: return false
        val scope = result.scope ?: return false
        if (scope.recipientDeviceId != sessionManager.configuredDeviceId) return false
        pendingRelayWorkCount = result.unparseableMessageIds.size + result.droppedForListBound.size
        return try {
            // Capture the complete bounded response before ANY acknowledgement.
            // This is transport custody, never verification or OS application.
            inbox.capture(scope, result.applied.map { it.envelopeWire ?: throw IllegalStateException("Missing envelope") })
            for (record in inbox.pendingAcknowledgements(scope)) {
                if (!sessionManager.isAuthenticated() || sessionManager.requireSessionToken() != sessionToken) return false
                relayHttpClient.acknowledgeInbound(sessionToken, record.messageId)
                inbox.markAcknowledged(scope, record.messageId, record.envelopeWire)
            }
            true
        } catch (_: Exception) {
            false
        }
    }
}
