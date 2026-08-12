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
     * BOOTSTRAP_AMBIGUOUS_RETRY_PROTOCOL_GAP, SAME PROCESS: the bootstrap request was sent and a
     * definitive outcome could not be determined -- see [BootstrapError.AmbiguousOutcome]'s own
     * doc for the exact conditions (network/timeout/connection-reset, or an unparseable 201
     * body). Reachable only while [rawInvitationToken][EnrollmentCoordinator] is still held in
     * memory (this process has not restarted since the ambiguous attempt).
     *
     * PCA-ENROLLMENT-RUNTIME-2 CLOSES the prior gap here: [EnrollmentCoordinator.retryBootstrap]
     * safely re-sends the SAME (attemptId, token, DSK, DEK) tuple -- the backend
     * (MySqlEnrollmentCoordinatorRepository) recognizes the retry and replays the original
     * result idempotently rather than creating a second device, or a fresh success if the
     * original request never actually reached the server. This state never auto-retries on its
     * own; the caller (UI) decides when to call [EnrollmentCoordinator.retryBootstrap].
     */
    data object BootstrapResultUnknown : EnrollmentState

    /**
     * BOOTSTRAP_AMBIGUOUS_RETRY_PROTOCOL_GAP, AFTER PROCESS/APP RESTART (or device reboot):
     * [EnrollmentCoordinator] restored a durably-persisted
     * [org.pca.app.storage.PendingEnrollmentAttempt] on construction -- the raw invitation token
     * is gone (never persisted, by design), so a plain retry of the original request is
     * impossible. [EnrollmentCoordinator.recoverAttempt] instead calls the dedicated recovery
     * endpoint (`POST /v1/enrollment/bootstrap/recover`) using only the durably-held
     * attemptId + attemptRecoveryToken, recovering the SAME deviceId if the original attempt
     * actually succeeded server-side, without ever re-presenting the invitation token.
     *
     * Deliberately distinct from [BootstrapResultUnknown] only for observability (which recovery
     * path is available) -- both represent "an attempt may or may not have succeeded server-side,
     * a definitive answer has not yet been obtained." If offline, callers should show this
     * honestly rather than claim success or failure, and resume recovery explicitly on
     * reconnect (bounded, not a retry storm) -- see [EnrollmentCoordinator.recoverAttempt]'s own
     * doc.
     */
    data class RecoveryPending(val serverBaseUrl: String) : EnrollmentState
}
