package org.pca.app.enrollment

/**
 * Client-side child-device enrollment state machine (PCA-ANDROID-ENROLLMENT-1). Deliberately
 * narrower than [PairingState]: this sealed interface is what [EnrollmentCoordinator] itself
 * drives, and it never has an ACTIVE/PAIRED variant -- a device that has just bootstrapped only
 * ever lands in [PairingPending], matching the server's own documented first status
 * (backend/src/http/dto.ts's BootstrapResultDto.status), never a locally-assumed higher state. A
 * later, separate feature slice reading the real, authenticated pairing status
 * ([org.pca.app.enrollment.PairingApiClient], parent-web/child-side follow-up) is the only thing
 * ever allowed to report PAIRED/ACTIVE, and it does so through its own model, not this one.
 */
sealed interface EnrollmentState {
    /** No local family state persisted yet -- the honest default, matching [org.pca.app.runtime.identity.DeviceIdentityState.NotEnrolled]. */
    data object NotEnrolled : EnrollmentState

    /** A syntactically valid invitation link has been parsed and its opaque token is held in memory; nothing has been sent to the server yet. */
    data class InvitationReady(val serverBaseUrl: String) : EnrollmentState

    /** Generating this device's DSK/DEK key pairs, before any network call is attempted. */
    data object PreparingKeys : EnrollmentState

    /** The bootstrap HTTP request is in flight. */
    data object Bootstrapping : EnrollmentState

    /** Bootstrap succeeded (HTTP 201, well-formed body): [deviceId] is the server-issued identity, now durably persisted. Awaiting the parent's pairing confirmation -- never shown as ACTIVE/PAIRED. */
    data class PairingPending(val deviceId: String) : EnrollmentState

    /** A definitive, non-ambiguous failure that a fresh attempt (parsing a link again, retrying the request) may resolve -- e.g. HTTP 400 or an unexpected 5xx. Never reached for network timeouts/ambiguous outcomes; see [BootstrapResultUnknown]. */
    data object FailedRetryable : EnrollmentState

    /** The invitation itself is unusable (unparseable link, or the server's generic 404 invitation_unavailable covering not-found/expired/revoked/already-redeemed). Deliberately not distinguished further -- see [BootstrapError.InvitationUnavailable]'s own doc. */
    data object FailedInvitationInvalid : EnrollmentState

    /** [org.pca.app.security.CryptoSuiteNotApprovedException] was thrown while preparing keys -- production key generation is not yet approved for release. Bootstrap never reached the network in this case. */
    data object CryptoReviewRequired : EnrollmentState

    /** This device's local family state reports it has been revoked. Reachable only by a future status-refresh path (not built by this coordinator) that reads the real, authenticated pairing status and writes REVOKED into [org.pca.app.storage.FamilyStateStore]. */
    data object Revoked : EnrollmentState

    /**
     * BOOTSTRAP_AMBIGUOUS_RETRY_PROTOCOL_GAP: the bootstrap request was sent and a definitive
     * outcome could not be determined -- see [BootstrapError.AmbiguousOutcome]'s own doc for the
     * exact conditions (network/timeout/connection-reset, or an unparseable 201 body). The
     * server-confirmed fact (independently verified by reading EnrollmentRepository.ts,
     * MySqlEnrollmentCoordinatorRepository.ts, and bootstrapRoutes.ts) is that there is no
     * idempotency key in the request DTO and no recovery path for an already-redeemed invitation:
     * a client-side retry of the same token after a true success returns a bare 404
     * invitation_unavailable, indistinguishable from the token never having been valid at all.
     *
     * This state deliberately asserts neither success nor failure. [EnrollmentCoordinator] never
     * auto-transitions out of it by retrying the same token; the only correct next step is a
     * human-directed one (ask the parent whether pairing shows up on their side, or issue a fresh
     * invitation) -- something this client cannot determine on its own from a bare 404.
     */
    data object BootstrapResultUnknown : EnrollmentState
}
