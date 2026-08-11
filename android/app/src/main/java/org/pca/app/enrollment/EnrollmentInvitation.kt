package org.pca.app.enrollment

/** Client-side mirror of the backend's Secure Invite HTTP contract (backend/src/http/dto.ts InvitationDto) -- parent-facing invitation state. Never carries the raw invitation token (see [EnrollmentInvitationCreated] for the one exception, at creation time only). */
data class EnrollmentInvitation(
    val invitationId: String,
    val familyId: String,
    val platform: String,
    val requestedProtectionMode: String,
    val status: String,
    val createdAt: String,
    val expiresAt: String,
    val openedAt: String?,
    val redeemedAt: String?,
    val revokedAt: String?,
)

/**
 * Returned exactly once, at creation time, mirroring backend
 * InvitationCreatedDto -- the raw one-time bearer token this app encodes
 * into the QR/deep-link for the child device. Never persisted beyond
 * immediate QR/link generation, never logged, never re-requestable from
 * the server afterward (the backend itself only returns it once).
 */
data class EnrollmentInvitationCreated(
    val invitation: EnrollmentInvitation,
    val rawInvitationToken: String,
)
