package org.pca.app.storage

import org.pca.app.foundation.PersistentStateStore

/**
 * Durable binding for [PendingEnrollmentAttemptStore], backed by the same generic
 * [PersistentStateStore] with its synchronous durability barrier. An unreadable present record
 * blocks enrollment; it never represents an absent attempt.
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
        val raw = DurableEnrollmentStorage.read(store, key) ?: return null
        return decode(raw)
    }

    override fun save(attempt: PendingEnrollmentAttempt) {
        DurableEnrollmentStorage.write(store, key, encode(attempt))
    }

    override fun compareAndSet(expected: PendingEnrollmentAttempt?, replacement: PendingEnrollmentAttempt?): Boolean =
        synchronized(store.coordinationLock) {
            val currentRaw = DurableEnrollmentStorage.read(store, key)
            val current = currentRaw?.let(::decode)
            if (current != expected) return@synchronized false
            // A durable in-flight attempt is the recovery identity for an ambiguous bootstrap.
            // Do not let a caller replace it with a fresh ceremony in one CAS. The existing
            // ceremony may update only its status; it must be explicitly resolved and cleared
            // before a new attempt can claim the slot.
            if (
                current != null && replacement != null &&
                current.copy(status = replacement.status) != replacement
            ) {
                return@synchronized false
            }
            if (current != null && replacement != null && !statusMayAdvance(current.status, replacement.status)) {
                return@synchronized false
            }
            DurableEnrollmentStorage.compareAndWrite(store, key, currentRaw, replacement?.let(::encode))
        }

    private fun statusMayAdvance(
        current: PendingEnrollmentAttemptStatus,
        replacement: PendingEnrollmentAttemptStatus,
    ): Boolean = when (current) {
        PendingEnrollmentAttemptStatus.PREPARED ->
            replacement == PendingEnrollmentAttemptStatus.PREPARED ||
                replacement == PendingEnrollmentAttemptStatus.BOOTSTRAPPING
        PendingEnrollmentAttemptStatus.BOOTSTRAPPING ->
            replacement == PendingEnrollmentAttemptStatus.BOOTSTRAPPING ||
                replacement == PendingEnrollmentAttemptStatus.RESULT_UNKNOWN
        PendingEnrollmentAttemptStatus.RESULT_UNKNOWN -> replacement == PendingEnrollmentAttemptStatus.RESULT_UNKNOWN
    }

    override fun clear() {
        DurableEnrollmentStorage.write(store, key, null)
    }

    internal fun encode(attempt: PendingEnrollmentAttempt): String {
        if (attempt.signingPrivateKeyAlias != DSK_ALIAS_PREFIX + attempt.attemptId ||
            attempt.encryptionPrivateKeyAlias != DEK_ALIAS_PREFIX + attempt.attemptId
        ) {
            throw EnrollmentPersistenceException()
        }
        return listOf(
            attempt.attemptId,
            attempt.attemptRecoveryToken,
            attempt.serverBaseUrl,
            attempt.platform,
            attempt.signingPublicKeyBase64,
            attempt.signingPrivateKeyAlias,
            attempt.encryptionPublicKeyBase64,
            attempt.encryptionPrivateKeyAlias,
            attempt.status.name,
            attempt.invitationTokenSha256.orEmpty(),
        ).joinToString(FIELD_SEPARATOR)
    }

    internal fun decode(raw: String): PendingEnrollmentAttempt? {
        val parts = raw.split(FIELD_SEPARATOR, limit = FIELD_COUNT)
        if (parts.size !in LEGACY_FIELD_COUNT..FIELD_COUNT) throw EnrollmentPersistenceException()
        return try {
            require(parts[5] == DSK_ALIAS_PREFIX + parts[0])
            require(parts[7] == DEK_ALIAS_PREFIX + parts[0])
            val invitationTokenSha256 = parts.getOrNull(9)?.takeIf { it.isNotEmpty() }
            require(invitationTokenSha256 == null || SHA256_HEX.matches(invitationTokenSha256))
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
                invitationTokenSha256 = invitationTokenSha256,
            )
        } catch (_: IllegalArgumentException) {
            // Present but unreadable recovery material must never look like an absent attempt.
            throw EnrollmentPersistenceException()
        }
    }

    private companion object {
        const val KEY = "pending_enrollment_attempt_v1"
        const val FIELD_SEPARATOR = "|"
        const val LEGACY_FIELD_COUNT = 9
        const val FIELD_COUNT = 10
        const val DSK_ALIAS_PREFIX = "pca.dsk."
        const val DEK_ALIAS_PREFIX = "pca.dek."
        val SHA256_HEX = Regex("^[0-9a-f]{64}$")
    }
}
