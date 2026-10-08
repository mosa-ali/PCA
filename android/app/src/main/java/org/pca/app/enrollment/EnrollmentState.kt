package org.pca.app.enrollment

/**
 * Client-side child-device enrollment state machine (PCA-ANDROID-ENROLLMENT-1). Deliberately
 * narrower than [PairingState]: this sealed interface is what [EnrollmentCoordinator] itself
 * drives, and it never has an ACTIVE/PAIRED variant -- a device that has just bootstrapped only
 * ever lands in [ProfileConfirmation] first, then [PairingPending] after the child confirms the
 * server-authorized profile, matching the server's own documented first status
 * (backend/src/http/dto.ts's BootstrapResultDto.status), never a locally-assumed higher state. A
 * later, separate feature slice reading the real, authenticated pairing status
 * ([org.pca.app.enrollment.PairingApiClient], parent-web/child-side follow-up) is the only thing
 * ever allowed to report PAIRED/ACTIVE, and it does so through its own model, not this one.
 */
sealed interface EnrollmentState {
    /** No local family state persisted yet -- the honest default, matching [org.pca.app.runtime.identity.DeviceIdentityState.NotEnrolled]. */
    data object NotEnrolled : EnrollmentState

    /** Persisted enrollment data exists but is corrupt; do not offer first-device enrollment or recovery actions. */
    data object LocalStateCorrupt : EnrollmentState

    /** A local durability operation failed; preserve key custody and block enrollment actions. */
    data object LocalPersistenceUnavailable : EnrollmentState

    /** A syntactically valid invitation link has been parsed and its opaque token is held in memory; nothing has been sent to the server yet. */
    data class InvitationReady(val serverBaseUrl: String) : EnrollmentState

    /**
     * The server has returned the parent-authorized profile, but this device has not yet
     * committed it locally. The child must see and confirm the age/mode context before the
     * enrollment result becomes local identity state. This is a confirmation model, not a
     * child override: the values are authoritative server output from the invitation.
     */
    data class ProfileConfirmation(
        val deviceId: String,
        val ageUxTier: AgeUxTier,
        val initialPolicyProfile: InitialPolicyProfile,
    ) : EnrollmentState

    /** Generating this device's DSK/DEK key pairs, before any network call is attempted. */
    data object PreparingKeys : EnrollmentState

    /** The bootstrap HTTP request is in flight. */
    data object Bootstrapping : EnrollmentState

    /** Bootstrap succeeded (HTTP 201, well-formed body): [deviceId] is the server-issued identity, now durably persisted. Awaiting the parent's pairing confirmation -- never shown as ACTIVE/PAIRED. */
    data class PairingPending(val deviceId: String) : EnrollmentState

    /** A retryable server failure with pending attempt and key custody retained; retry uses the same tuple. */
    data object FailedRetryable : EnrollmentState

    /** A link was malformed or a caller used an invalid state transition; a generic server 404 stays unresolved in [BootstrapResultUnknown] or [RecoveryPending]. */
    data object FailedInvitationInvalid : EnrollmentState

    /** [org.pca.app.security.CryptoSuiteNotApprovedException] was thrown while preparing keys -- production key generation is not yet approved for release. Bootstrap never reached the network in this case. */
    data object CryptoReviewRequired : EnrollmentState

    /**
     * Wave 6C: [org.pca.app.security.SecureKeyUnavailableException] was
     * thrown while preparing keys -- the platform could not provide (or
     * attest) a hardware-backed key pair. No software-only key may ever
     * enter the trust-root path, so the attempt stops before any network
     * call and before any durable record exists.
     */
    data object SecureKeyUnavailable : EnrollmentState

    /** This device's local family state reports it has been revoked. Reachable only by a future status-refresh path (not built by this coordinator) that reads the real, authenticated pairing status and writes REVOKED into [org.pca.app.storage.FamilyStateStore]. */
    data object Revoked : EnrollmentState

    /**
     * BOOTSTRAP_AMBIGUOUS_RETRY_PROTOCOL_GAP: the bootstrap request was sent and a
     * definitive outcome could not be determined -- see [BootstrapError.AmbiguousOutcome],
     * [BootstrapError.InvalidRequest], and [BootstrapError.InvitationUnavailable] (network or
     * timeout, generic 400/404, or unparseable 201 body). It is reachable when the token remains
     * in memory or after the exact invitation has been rescanned and matched to the durable digest.
     *
     * [EnrollmentCoordinator.retryBootstrap] explicitly re-sends the same attemptId, invitation,
     * recovery token, platform, DSK and DEK tuple. A same-link rescan after restart can restore
     * the invitation in memory only when its SHA-256 binding matches the durable attempt. This
     * state never auto-retries; the caller (UI) decides when to retry or recover.
     */
    data object BootstrapResultUnknown : EnrollmentState

    /**
     * BOOTSTRAP_AMBIGUOUS_RETRY_PROTOCOL_GAP, AFTER PROCESS/APP RESTART (or device reboot):
     * [EnrollmentCoordinator] restored a durably-persisted
     * [org.pca.app.storage.PendingEnrollmentAttempt] on construction. The raw invitation token
     * is never persisted. Recovery uses the durable attemptId + attemptRecoveryToken; if recovery
     * remains unresolved, a user can rescan the original invitation and the coordinator will
     * permit an explicit exact-attempt retry only when its digest matches and [custodyConflict]
     * is false.
     *
     * Deliberately distinct from [BootstrapResultUnknown] only for observability (which recovery
     * path is available) -- both represent "an attempt may or may not have succeeded server-side,
     * a definitive answer has not yet been obtained." A recovery HTTP 404 is still unresolved:
     * the backend's generic response and non-locking lookup cannot rule out an original bootstrap
     * transaction that has not committed yet. Callers must preserve pending credentials and keys.
     * If offline, callers should show this honestly rather than claim success or failure, and resume
     * recovery explicitly on reconnect (bounded, not a retry storm) -- see
     * [EnrollmentCoordinator.recoverAttempt]'s own doc.
     */
    data class RecoveryPending(
        val serverBaseUrl: String,
        val invitationRescanRejected: Boolean = false,
        /** Server resolution conflicts with, or cannot be reconciled against, local root custody. */
        val custodyConflict: Boolean = false,
    ) : EnrollmentState
}
