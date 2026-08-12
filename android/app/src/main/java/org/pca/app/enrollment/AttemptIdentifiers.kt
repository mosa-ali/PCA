package org.pca.app.enrollment

import java.security.SecureRandom
import java.util.Base64

/**
 * PCA-ENROLLMENT-RUNTIME-2: generates the two client-side, high-entropy identifiers a bootstrap
 * attempt needs -- see [org.pca.app.storage.PendingEnrollmentAttempt]'s own doc for what each is
 * used for and why neither is the raw invitation token. Both use the platform CSPRNG
 * ([SecureRandom]), never `Math.random()` or a hand-rolled generator, mirroring
 * backend/src/invitation/token.ts's own rule for the invitation token itself. Encoded base64url
 * without padding (RFC 4648 §5) to match the server's own `[A-Za-z0-9_-]+` validators
 * (backend/src/enrollment/attempt.ts's isPlausibleAttemptId/isPlausibleAttemptRecoveryToken).
 */
object AttemptIdentifiers {
    // 24 bytes = 192 bits of entropy -> 32 base64url chars (no padding), comfortably within the
    // server's 16-64 char bound.
    private const val ATTEMPT_ID_BYTES = 24

    // 32 bytes = 256 bits of entropy -> 43 base64url chars (no padding), matching the invitation
    // token's own entropy budget, within the server's 32-88 char bound.
    private const val RECOVERY_TOKEN_BYTES = 32

    private val random = SecureRandom()
    private val encoder: Base64.Encoder = Base64.getUrlEncoder().withoutPadding()

    /** Generated ONCE per logical enrollment attempt and reused for every retry of that attempt -- never regenerated on retry. */
    fun newAttemptId(): String = encoder.encodeToString(randomBytes(ATTEMPT_ID_BYTES))

    /** Generated ONCE per logical enrollment attempt, alongside [newAttemptId], and persisted durably before the original request is sent. */
    fun newAttemptRecoveryToken(): String = encoder.encodeToString(randomBytes(RECOVERY_TOKEN_BYTES))

    private fun randomBytes(count: Int): ByteArray {
        val bytes = ByteArray(count)
        random.nextBytes(bytes)
        return bytes
    }
}
