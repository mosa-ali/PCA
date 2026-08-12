package org.pca.app.storage

import org.pca.app.foundation.PersistentStateStore

/**
 * Durable binding for [PendingEnrollmentAttemptStore], backed by the same generic
 * [PersistentStateStore] (durable, OS-backed at-rest protection) every other runtime snapshot in
 * this app uses -- mirrors [PersistentFamilyStateStore]'s own encode/decode-with-fail-safe-null
 * pattern exactly.
 *
 * This is the ONLY durable record PCA-ENROLLMENT-RUNTIME-2 writes before the bootstrap network
 * call. [PendingEnrollmentAttempt] has no raw-invitation-token field, so there is no way for this
 * class to persist it even by mistake -- see that data class's own doc comment.
 */
class PersistentPendingEnrollmentAttemptStore(
    private val store: PersistentStateStore,
    private val key: String = KEY,
) : PendingEnrollmentAttemptStore {

    override fun current(): PendingEnrollmentAttempt? {
        val raw = store.getString(key) ?: return null
        return decode(raw)
    }

    override fun save(attempt: PendingEnrollmentAttempt) {
        store.putString(key, encode(attempt))
    }

    override fun clear() {
        store.remove(key)
    }

    internal fun encode(attempt: PendingEnrollmentAttempt): String = listOf(
        attempt.attemptId,
        attempt.attemptRecoveryToken,
        attempt.serverBaseUrl,
        attempt.platform,
        attempt.signingPublicKeyBase64,
        attempt.signingPrivateKeyAlias,
        attempt.encryptionPublicKeyBase64,
        attempt.encryptionPrivateKeyAlias,
        attempt.status.name,
    ).joinToString(FIELD_SEPARATOR)

    internal fun decode(raw: String): PendingEnrollmentAttempt? {
        val parts = raw.split(FIELD_SEPARATOR, limit = FIELD_COUNT)
        if (parts.size != FIELD_COUNT) return null
        return try {
            PendingEnrollmentAttempt(
                attemptId = parts[0],
                attemptRecoveryToken = parts[1],
                serverBaseUrl = parts[2],
                platform = parts[3],
                signingPublicKeyBase64 = parts[4],
                signingPrivateKeyAlias = parts[5],
                encryptionPublicKeyBase64 = parts[6],
                encryptionPrivateKeyAlias = parts[7],
                status = PendingEnrollmentAttemptStatus.valueOf(parts[8]),
            )
        } catch (_: IllegalArgumentException) {
            // Malformed/corrupt persisted value -- fail safe to "no pending attempt" rather than
            // crash or fabricate recovery material.
            null
        }
    }

    private companion object {
        const val KEY = "pending_enrollment_attempt_v1"
        const val FIELD_SEPARATOR = "|"
        const val FIELD_COUNT = 9
    }
}
