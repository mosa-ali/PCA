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

/**
 * PCA-ADD-ENR-016/PCA-FR-145: the exact wire vocabulary
 * `backend/src/http/routes/runtimeSyncRoutes.ts`'s `PROTECTION_LEVELS` set accepts on
 * `POST /v1/runtime-sync/protection-status` -- anything else is rejected 400 `invalid_request`.
 * A typed enum rather than a bare `String` (contrast [RelayHttpClient.getStatus]'s response, which
 * this app only displays) because this one is a REQUEST body: a typo would be a silently dropped
 * tamper alert, not a visibly wrong label. Deliberately declared here, in the transport surface
 * that mirrors the route file, rather than reusing `org.pca.app.platform.ProtectionMode` directly
 * -- the mapping between the two is an explicit `when` in
 * [org.pca.app.runtime.sync.toRelayProtectionLevel], so a rename on either side is a compile error
 * instead of a wrong value on the wire.
 */
enum class RelayProtectionLevel { STANDARD, PROTECTED, DEGRADED, AUTHORIZATION_REQUIRED, NOT_SUPPORTED }

sealed class RelayHttpErrorCode { object Unauthorized : RelayHttpErrorCode(); object InvalidRequest : RelayHttpErrorCode(); object Network : RelayHttpErrorCode(); object Unknown : RelayHttpErrorCode() }
class RelayHttpException(val errorCode: RelayHttpErrorCode, message: String) : Exception(message)

interface RelayHttpClient {
    suspend fun issueChallenge(deviceId: String): ChallengeResponse
    suspend fun completeChallenge(deviceId: String, challengeId: String, signature: String): DeviceSessionInfo
    suspend fun submitOutbound(sessionToken: String, items: List<OutboundSubmitItem>): OutboundBatchResult
    suspend fun listInbound(sessionToken: String): InboundListResult
    suspend fun acknowledgeInbound(sessionToken: String, messageId: String)
    suspend fun getStatus(sessionToken: String): String

    /**
     * The seventh runtime-sync route, and the only one this client did not implement: the device's
     * own protection level, the ONE input `backend/src/familyrbac/RealProtectiveAuthorityResolver.ts`
     * reads and the trigger for the backend's PCA-ADD-ENR-020 "protection degraded" family alert.
     * Without it every capability degradation this app detects (device-owner authority lost, usage
     * access revoked, VPN consent withdrawn, camera permission revoked, wall-clock rollback) stayed
     * device-local: the child could dismiss the local notification and the parent would never learn.
     *
     * `familyId`/`deviceId` are taken by the backend from the verified device session, never from
     * the body -- a device can only ever report its own status. Responds 204 with an empty body.
     */
    suspend fun reportProtectionStatus(sessionToken: String, protectionLevel: RelayProtectionLevel)
}
