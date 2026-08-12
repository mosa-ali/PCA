package org.pca.app.runtime.sync.transport

/** Mirrors backend/src/http/routes/runtimeSyncRoutes.ts's surface exactly (doc 40 Section 4) -- one method per route, never a generic escape hatch. */

data class ChallengeResponse(val challengeId: String, val nonce: String, val expiresAt: String)
data class DeviceSessionInfo(val sessionToken: String, val expiresAt: String)

data class OutboundSubmitItem(
    val messageId: String,
    val recipientDeviceId: String,
    val ciphertextBase64: String,
    val messageType: String,
    val enqueuedAtEpochMillis: Long,
    val ttlMillis: Long? = null,
)

data class OutboundItemOutcome(val messageId: String, val outcome: String)
data class OutboundBatchResult(val results: List<OutboundItemOutcome>, val droppedForBatchBound: List<String>)

data class InboundAppliedEnvelope(val messageId: String, val senderDeviceId: String, val messageType: String, val payloadBase64: String)
data class InboundListResult(
    val applied: List<InboundAppliedEnvelope>,
    val unparseableMessageIds: List<String>,
    val droppedForListBound: List<String>,
)

sealed class RelayHttpErrorCode { object Unauthorized : RelayHttpErrorCode(); object InvalidRequest : RelayHttpErrorCode(); object Network : RelayHttpErrorCode(); object Unknown : RelayHttpErrorCode() }
class RelayHttpException(val errorCode: RelayHttpErrorCode, message: String) : Exception(message)

interface RelayHttpClient {
    suspend fun issueChallenge(deviceId: String): ChallengeResponse
    suspend fun completeChallenge(deviceId: String, challengeId: String, signature: String): DeviceSessionInfo
    suspend fun submitOutbound(sessionToken: String, items: List<OutboundSubmitItem>): OutboundBatchResult
    suspend fun listInbound(sessionToken: String): InboundListResult
    suspend fun acknowledgeInbound(sessionToken: String, messageId: String)
    suspend fun getStatus(sessionToken: String): String
}
