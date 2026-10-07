package org.pca.app.runtime.trustset

enum class TrustSetRole { OWNER, ADMINISTRATOR, VIEWER, CHILD }
enum class TrustSetMembershipStatus { ACTIVE, ROTATION_PENDING, DEVICE_OFFLINE, REVOKED, EPOCH_STALE, RECOVERY_REQUIRED }

/** Structural candidate only: membership status never changes the device lifecycle. */
data class UntrustedTrustSetEntry(
    val deviceId: String, val role: TrustSetRole,
    val dskKeyId: String, val dskPublicKey: String,
    val dekKeyId: String, val dekPublicKey: String,
    val status: TrustSetMembershipStatus,
)

/** No signature verification, accepted epoch/floor, anchor or policy authority is represented here. */
data class UntrustedTrustSetEpoch(
    val familyId: String, val trustSetEpoch: Int, val keyEpoch: Int,
    val entries: List<UntrustedTrustSetEntry>,
    /** Exact backend Date.toISOString representation, including expanded years. */
    val issuedAt: String, val supersedesEpoch: Int?,
    /** Canonical decoding has no signature and deliberately returns an empty value. */
    val signature: String = "",
)

class TrustSetCodecException : Exception("malformed_untrusted_trust_set")
