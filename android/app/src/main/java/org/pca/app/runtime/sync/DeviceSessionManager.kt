package org.pca.app.runtime.sync

import java.time.Instant
import kotlinx.coroutines.ensureActive
import org.pca.app.runtime.sync.transport.DeviceSessionInfo
import org.pca.app.runtime.sync.transport.RelayHttpClient
import org.pca.app.security.DskSignatureEngine

/** Provider output is already canonical 64-byte P1363; never DER-decode it twice. */
internal fun signRuntimeDeviceChallenge(engine: DskSignatureEngine, alias: String, nonce: String): String {
    val signature = engine.signCanonicalDer(alias, nonce.toByteArray(Charsets.UTF_8))
    require(signature.size == 64) { "Invalid device signature" }
    return java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(signature)
}

/** Signs a device-authentication challenge nonce with this device's DSK. See envelope/EnvelopeSignatureVerifier.kt's doc comment -- the concrete signing implementation behind this interface is gated the same way (PRODUCTION_CRYPTO_SUITE = PENDING_HUMAN_SECURITY_REVIEW). */
fun interface ChallengeSigner {
    suspend fun sign(nonce: String): String
}

class DeviceSessionChanged : Exception("Device session changed")

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
    private val assertKeyCustody: () -> Unit,
    private val nowEpochMillis: () -> Long = { System.currentTimeMillis() },
) {
    val configuredDeviceId: String get() = deviceId
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
        verifyKeyCustody()
        val challenge = relayHttpClient.issueChallenge(deviceId)
        kotlinx.coroutines.currentCoroutineContext().ensureActive()
        verifyKeyCustody()
        val signature = signer.sign(challenge.nonce)
        kotlinx.coroutines.currentCoroutineContext().ensureActive()
        verifyKeyCustody()
        val newSession = relayHttpClient.completeChallenge(deviceId, challenge.challengeId, signature)
        kotlinx.coroutines.currentCoroutineContext().ensureActive()
        verifyKeyCustody()
        session = newSession
        return newSession
    }

    suspend fun requireSessionToken(): String {
        verifyKeyCustody()
        if (isAuthenticated()) return (session as DeviceSessionInfo).sessionToken
        return authenticate().sessionToken
    }

    /** Continuity check only: never authenticate a replacement across an awaited operation. */
    fun assertCurrentSession(expectedToken: String) {
        verifyKeyCustody()
        if (!isAuthenticated() || session?.sessionToken != expectedToken) throw DeviceSessionChanged()
    }

    /** A rejected token cannot clear a replacement authenticated by another caller. */
    fun invalidateRejectedSession(expectedToken: String) {
        if (session?.sessionToken == expectedToken) session = null
    }

    private fun verifyKeyCustody() {
        try { assertKeyCustody() } catch (error: Exception) {
            session = null
            throw error
        }
    }
}
