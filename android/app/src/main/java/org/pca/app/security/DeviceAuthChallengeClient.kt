package org.pca.app.security

/**
 * Client-side counterpart to the backend's device-authentication
 * challenge/response protocol (backend/src/deviceauth,
 * DeviceAuthService.issueChallenge/verifyChallenge). This device requests
 * a single-use, short-TTL nonce, signs it with its own DSK (via
 * [DeviceChallengeSigner], not this interface), and submits the signature
 * to prove it still holds the private key matching its registered DSK --
 * see backend/src/deviceauth/DeviceAuthService.ts for the full protocol
 * this mirrors. Issues no session/token/family authority of any kind by
 * itself.
 */
interface DeviceAuthChallengeClient {
    suspend fun requestChallenge(deviceId: String): DeviceAuthChallenge
    suspend fun submitSignedChallenge(challengeId: String, signatureBase64: String): DeviceAuthResult
}

data class DeviceAuthChallenge(
    val challengeId: String,
    val nonceBase64: String,
    val expiresAtEpochMillis: Long,
)

data class DeviceAuthResult(
    val deviceId: String,
    val familyId: String,
)

/**
 * Signs a device-auth challenge nonce with the device's own DSK, referenced
 * by [SecureKeyStore] alias. NO signature algorithm implemented here --
 * gated behind CRYPTO_SUITE = WAITING_HUMAN_SECURITY_REVIEW, mirrors the
 * backend's EnvelopeSignatureVerifier/DeviceSignatureVerifier pattern from
 * the client side.
 */
interface DeviceChallengeSigner {
    suspend fun sign(nonceBase64: String, privateKeyAlias: String): String
}
