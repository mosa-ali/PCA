package org.pca.app.feature.screentime.persistence

import org.pca.app.foundation.PersistentStateStore
import java.nio.charset.StandardCharsets
import java.security.MessageDigest

/**
 * Durable single-use authorization claims stored in the app's existing protected state store.
 * The audit id is represented by a fixed-size SHA-256 key so the local preference key remains
 * bounded even though the authorization model does not define an audit-id length limit. No
 * expiration or pruning is applied: deleting a claim could make a previously used authorization
 * replayable. A digest collision can only reject a distinct id as already used, so it fails
 * closed.
 *
 * [PersistentStateStore.coordinationLock] serializes adapters wrapping the same underlying file.
 * The synchronous [PersistentStateStore.flush] barrier is part of the claim: `true` is returned
 * only after the claim is durably committed. If storage fails, the exception propagates and the
 * caller must not apply the authorization.
 *
 * This is replay bookkeeping only. It does not validate a Parent signature or authorize a caller.
 */
class PersistentUsedAuthorizationStore(
    private val store: PersistentStateStore,
) : UsedAuthorizationStore {

    override fun claimAuthorization(auditId: String): Boolean {
        require(auditId.isNotBlank()) { "auditId must not be blank" }
        val key = KEY_PREFIX + sha256Hex(auditId)

        return synchronized(store.coordinationLock) {
            if (store.contains(key)) {
                false
            } else {
                store.putString(key, CLAIMED_VALUE)
                store.flush()
                true
            }
        }
    }

    private fun sha256Hex(value: String): String {
        val digest = MessageDigest.getInstance("SHA-256")
            .digest(value.toByteArray(StandardCharsets.UTF_8))
        val hex = CharArray(digest.size * 2)
        for (index in digest.indices) {
            val unsigned = digest[index].toInt() and 0xff
            hex[index * 2] = HEX[unsigned ushr 4]
            hex[index * 2 + 1] = HEX[unsigned and 0x0f]
        }
        return String(hex)
    }

    private companion object {
        const val KEY_PREFIX = "parent_authorization_used_v1_"
        const val CLAIMED_VALUE = "claimed"
        const val HEX = "0123456789abcdef"
    }
}
