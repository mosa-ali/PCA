package org.pca.app.storage

/**
 * PCA-ENROLLMENT-RUNTIME-2: durable, narrow state for ONE in-flight or ambiguous enrollment
 * attempt -- written BEFORE the bootstrap network request is sent, so it survives process death,
 * app restart, device reboot, and response loss (closing BOOTSTRAP_AMBIGUOUS_RETRY_PROTOCOL_GAP).
 *
 * Deliberately does NOT hold the raw invitation bearer token: this data class has no such field,
 * so [PersistentPendingEnrollmentAttemptStore] has no code path by which it could persist it even
 * by mistake. It stores only [invitationTokenSha256], which allows an exact user-rescan after
 * restart without retaining the bearer token.
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
    /** SHA-256 binding used only to recognize a user-rescanned copy of this invite after restart. */
    val invitationTokenSha256: String? = null,
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
enum class PendingEnrollmentAttemptStatus { PREPARED, BOOTSTRAPPING, RESULT_UNKNOWN }

interface PendingEnrollmentAttemptStore {
    fun current(): PendingEnrollmentAttempt?
    /** Unconditional write for test/setup fixtures; coordinator lifecycle writes must use compareAndSet. */
    fun save(attempt: PendingEnrollmentAttempt)
    /** Atomically replace only the exact expected record; null means the slot must be empty. */
    fun compareAndSet(expected: PendingEnrollmentAttempt?, replacement: PendingEnrollmentAttempt?): Boolean
    /** Unconditional removal for test/setup fixtures; coordinator cleanup must use compareAndSet. */
    fun clear()
}

/** In-memory reference implementation -- real and usable for composition/dev builds, NOT durable across process death (defeats this store's entire purpose in a real build). */
class InMemoryPendingEnrollmentAttemptStore : PendingEnrollmentAttemptStore {
    private var attempt: PendingEnrollmentAttempt? = null

    @Synchronized override fun current(): PendingEnrollmentAttempt? = attempt
    @Synchronized override fun save(attempt: PendingEnrollmentAttempt) { this.attempt = attempt }
    @Synchronized override fun compareAndSet(expected: PendingEnrollmentAttempt?, replacement: PendingEnrollmentAttempt?): Boolean {
        if (attempt != expected) return false
        attempt = replacement
        return true
    }
    @Synchronized override fun clear() { attempt = null }
}
