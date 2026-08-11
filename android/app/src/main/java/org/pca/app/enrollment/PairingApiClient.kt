package org.pca.app.enrollment

/**
 * Client-side mirror of the backend device lifecycle
 * (backend/src/device/types.ts DeviceStatus): PAIRING_PENDING -> PAIRED ->
 * ACTIVE, REVOKED. This client NEVER locally decides a transition to
 * ACTIVE -- ACTIVE is only ever reported by the server after Family Trust
 * Set first-policy delivery (owned by backend/src/familytrustset device-
 * side logic, wired in by a later slice, not this one).
 */
enum class PairingState { PAIRING_PENDING, PAIRED, ACTIVE, REVOKED }

data class PairingRequestView(
    val deviceId: String,
    val platform: String,
    val status: PairingState,
    val dskFingerprint: String?,
    val dekFingerprint: String?,
)

/** Client-side contract for backend/src/http/routes/pairingRoutes.ts -- the parent-authenticated pairing view/confirm surface. */
interface PairingApiClient {
    suspend fun getPairingRequest(familyId: String, deviceId: String): PairingRequestView
    suspend fun confirmPairing(familyId: String, deviceId: String): PairingRequestView
}
