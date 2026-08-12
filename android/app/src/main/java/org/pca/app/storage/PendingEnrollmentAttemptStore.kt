package org.pca.app.storage

/**
 * PCA-ENROLLMENT-RUNTIME-2: durable, narrow state for ONE in-flight or ambiguous enrollment
 * attempt -- written BEFORE the bootstrap network request is sent, so it survives process death,
 * app restart, device reboot, and response loss (closing BOOTSTRAP_AMBIGUOUS_RETRY_PROTOCOL_GAP).
 *
 * Deliberately does NOT hold the raw invitation bearer token: this data class has no such field,
 * so [PersistentPendingEnrollmentAttemptStore] has no code path by which it could persist it even
 * by mistake -- the raw token continues to live ONLY in [EnrollmentCoordinator]'s in-memory field,
 * exactly as before this migration (see that class's own doc comment).
 *
 * [attemptId] is the client-generated, high-entropy, NON-secret retry correlator
 * (backend/src/enrollment/attempt.ts's bootstrapAttemptId) -- safe to persist in the clear.
 * [attemptRecoveryToken] IS a secret, but a different one from the invitation token: this app
 * generates it itself, for the sole purpose of later proving to the backend's recovery endpoint
 * that a recovery caller is the same party that made the original request. Durably holding it is
 * the entire point of this store -- a response-loss recovery that could not survive process death
 * would not close the gap at all. The signing/encryption key material fields let a retry or
 * recovery reconstruct/reuse the EXACT same DSK/DEK identity rather than minting a new key pair
 * (mission Section 11) -- [signingPrivateKeyAlias]/[encryptionPrivateKeyAlias] reference
 * [org.pca.app.security.SecureKeyStore] entries, never raw private key bytes.
 */
data class PendingEnrollmentAttempt(
    val attemptId: String,
    val attemptRecoveryToken: String,
    val serverBaseUrl: String,
    val platform: String,
    val signingPublicKeyBase64: String,
    val signingPrivateKeyAlias: String,
    val encryptionPublicKeyBase64: String,
    val encryptionPrivateKeyAlias: String,
    val status: PendingEnrollmentAttemptStatus,
)

/**
 * [BOOTSTRAPPING]: keys were generated and persisted, the bootstrap request is about to be/being
 * sent -- no server response has been observed yet (covers "process died before any response, or
 * even before the request left the device").
 *
 * [RESULT_UNKNOWN]: the request was sent but its outcome could not be determined (timeout,
 * connection reset, unparseable success body) -- BOOTSTRAP_AMBIGUOUS_RETRY_PROTOCOL_GAP's exact
 * condition. Recovery (or, same-process, a plain retry reusing this same attempt) is the correct
 * next step, never a fresh attempt with new keys.
 *
 * Both statuses are handled identically by [EnrollmentCoordinator]'s restart-recovery path -- the
 * distinction exists for observability/debugging, not different recovery logic, since from a
 * restarted process's point of view both are "an attempt may or may not have succeeded server-side."
 */
enum class PendingEnrollmentAttemptStatus { BOOTSTRAPPING, RESULT_UNKNOWN }

interface PendingEnrollmentAttemptStore {
    fun current(): PendingEnrollmentAttempt?
    fun save(attempt: PendingEnrollmentAttempt)
    /** Section 12: called once an attempt is either successfully recovered, or definitively abandoned (invalid/revoked invitation) -- never on a merely-ambiguous outcome. */
    fun clear()
}

/** In-memory reference implementation -- real and usable for composition/dev builds, NOT durable across process death (defeats this store's entire purpose in a real build). */
class InMemoryPendingEnrollmentAttemptStore : PendingEnrollmentAttemptStore {
    private var attempt: PendingEnrollmentAttempt? = null

    override fun current(): PendingEnrollmentAttempt? = attempt
    override fun save(attempt: PendingEnrollmentAttempt) { this.attempt = attempt }
    override fun clear() { attempt = null }
}
