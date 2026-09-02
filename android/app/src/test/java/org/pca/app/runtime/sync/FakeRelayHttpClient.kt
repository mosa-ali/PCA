package org.pca.app.runtime.sync

import org.pca.app.runtime.sync.transport.ChallengeResponse
import org.pca.app.runtime.sync.transport.DeviceSessionInfo
import org.pca.app.runtime.sync.transport.InboundAppliedEnvelope
import org.pca.app.runtime.sync.transport.InboundListResult
import org.pca.app.runtime.sync.transport.OutboundBatchResult
import org.pca.app.runtime.sync.transport.OutboundItemOutcome
import org.pca.app.runtime.sync.transport.OutboundSubmitItem
import org.pca.app.runtime.sync.transport.RelayHttpClient
import org.pca.app.runtime.sync.transport.RelayHttpErrorCode
import org.pca.app.runtime.sync.transport.RelayHttpException
import org.pca.app.runtime.sync.transport.RelayProtectionLevel

/** Deterministic in-memory RelayHttpClient for tests only -- simulates the backend surface, including per-messageId ack tracking so re-listing only returns items not yet acknowledged. */
class FakeRelayHttpClient(
    private val recipientQueue: MutableList<InboundAppliedEnvelope> = mutableListOf(),
) : RelayHttpClient {
    val submittedBatches = mutableListOf<List<OutboundSubmitItem>>()
    val acknowledgedMessageIds = mutableListOf<String>()
    /** Every protection-status report this fake received, in order -- lets a test assert the device actually reported a degradation rather than only detecting it locally. */
    val reportedProtectionLevels = mutableListOf<RelayProtectionLevel>()
    var failNextSubmit = false
    var failNextList = false

    fun enqueueInbound(envelope: InboundAppliedEnvelope) {
        recipientQueue.add(envelope)
    }

    override suspend fun issueChallenge(deviceId: String): ChallengeResponse =
        ChallengeResponse(challengeId = "challenge-for-$deviceId", nonce = "nonce-for-$deviceId", expiresAt = "2099-01-01T00:00:00.000Z")

    override suspend fun completeChallenge(deviceId: String, challengeId: String, signature: String): DeviceSessionInfo =
        DeviceSessionInfo(sessionToken = "session-for-$deviceId", expiresAt = "2099-01-01T00:00:00.000Z")

    /** Records the report. The real client sends familyId/deviceId from the verified session, never the body, so there is nothing else to capture here. */
    override suspend fun reportProtectionStatus(sessionToken: String, protectionLevel: RelayProtectionLevel) {
        reportedProtectionLevels.add(protectionLevel)
    }

    override suspend fun submitOutbound(sessionToken: String, items: List<OutboundSubmitItem>): OutboundBatchResult {
        if (failNextSubmit) {
            failNextSubmit = false
            throw RelayHttpException(RelayHttpErrorCode.Network, "simulated network failure")
        }
        submittedBatches.add(items)
        return OutboundBatchResult(items.map { OutboundItemOutcome(it.messageId, "QUEUED") }, emptyList())
    }

    override suspend fun listInbound(sessionToken: String): InboundListResult {
        if (failNextList) {
            failNextList = false
            throw RelayHttpException(RelayHttpErrorCode.Network, "simulated network failure")
        }
        // Real backend auto-acknowledges everything it returns as "applied"
        // -- mirror that here so a repeated listInbound() call (e.g. across
        // a connectivity flap) does not return the same envelope twice.
        val snapshot = recipientQueue.toList()
        recipientQueue.clear()
        return InboundListResult(applied = snapshot, unparseableMessageIds = emptyList(), droppedForListBound = emptyList())
    }

    override suspend fun acknowledgeInbound(sessionToken: String, messageId: String) {
        acknowledgedMessageIds.add(messageId)
    }

    override suspend fun getStatus(sessionToken: String): String = "LIVE"
}
