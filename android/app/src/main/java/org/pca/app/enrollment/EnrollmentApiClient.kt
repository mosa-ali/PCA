package org.pca.app.enrollment

/**
 * Client-side contract for the Secure Invite HTTP surface the backend
 * already implements (backend/src/http/routes/invitationRoutes.ts). This
 * interface fixes the shape a concrete HTTP transport implements --
 * transport/serialization library selection is a separate, later
 * decision; callers depend on this interface only.
 */
interface EnrollmentApiClient {
    suspend fun createInvitation(
        familyId: String,
        platform: String,
        requestedProtectionMode: String,
    ): EnrollmentInvitationCreated

    suspend fun getInvitationStatus(familyId: String, invitationId: String): EnrollmentInvitation
    suspend fun listInvitations(familyId: String): List<EnrollmentInvitation>
    suspend fun revokeInvitation(familyId: String, invitationId: String): EnrollmentInvitation
}

/** Child-side mirror of backend BootstrapResultDto (backend/src/http/dto.ts). */
data class DeviceBootstrapResult(val deviceId: String, val status: String)

/**
 * Client-side contract for the unauthenticated child bootstrap endpoint
 * (backend/src/http/routes/bootstrapRoutes.ts) -- authorized solely by
 * possession of the one-time invitation bearer token, never by any local
 * app state. Never sends familyId, role, or any authority claim; the
 * server derives those entirely from the redeemed invitation record.
 */
interface DeviceBootstrapApiClient {
    suspend fun bootstrap(
        rawInvitationToken: String,
        platform: String,
        signingPublicKeyBase64: String,
        encryptionPublicKeyBase64: String,
    ): DeviceBootstrapResult
}
