package org.pca.app.runtime.sync

import java.time.Instant
import org.pca.app.runtime.sync.transport.DeviceSessionInfo
import org.pca.app.runtime.sync.transport.RelayHttpClient

/** Signs a device-authentication challenge nonce with this device's DSK. See envelope/EnvelopeSignatureVerifier.kt's doc comment -- the concrete signing implementation behind this interface is gated the same way (PRODUCTION_CRYPTO_SUITE = PENDING_HUMAN_SECURITY_REVIEW). */
fun interface ChallengeSigner {
    suspend fun sign(nonce: String): String
}

/**
 * Device-side counterpart of backend/src/runtime-sync/DeviceSessionService.ts:
 * requests a challenge, signs it, exchanges it for a short-lived device
 * session token, and re-authenticates transparently once that token
 * expires. Holds the session in memory only -- never persisted, mirroring
 * the backend's own non-durable session store (losing it just costs one
 * more cheap challenge/response round-trip).
 */
class DeviceSessionManager(
    private val relayHttpClient: RelayHttpClient,
    private val deviceId: String,
    private val signer: ChallengeSigner,
    private val nowEpochMillis: () -> Long = { System.currentTimeMillis() },
) {
    private var session: DeviceSessionInfo? = null

    fun isAuthenticated(): Boolean {
        val current = session ?: return false
        return try {
            Instant.parse(current.expiresAt).toEpochMilli() > nowEpochMillis()
        } catch (_: Exception) {
            false
        }
    }

    suspend fun authenticate(): DeviceSessionInfo {
        val challenge = relayHttpClient.issueChallenge(deviceId)
        val signature = signer.sign(challenge.nonce)
        val newSession = relayHttpClient.completeChallenge(deviceId, challenge.challengeId, signature)
        session = newSession
        return newSession
    }

    suspend fun requireSessionToken(): String {
        if (isAuthenticated()) return (session as DeviceSessionInfo).sessionToken
        return authenticate().sessionToken
    }
}
