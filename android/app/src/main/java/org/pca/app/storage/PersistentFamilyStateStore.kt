package org.pca.app.storage

import org.pca.app.enrollment.PairingState
import org.pca.app.foundation.PersistentStateStore

/**
 * PCA-RUNTIME-2R1: durable binding for [FamilyStateStore], backed by the same generic
 * [PersistentStateStore] (durable, OS-backed at-rest protection) every other runtime snapshot in
 * this app uses -- replacing [InMemoryFamilyStateStore], which does not survive process death and
 * is therefore unusable as the actual production source of a device's own enrolled identity.
 *
 * This class only persists/reads whatever [LocalFamilyState] it is given; it does not itself
 * perform enrollment or contact the backend -- that remains
 * [org.pca.app.enrollment.DeviceBootstrapApiClient]'s job (a real HTTP implementation of which
 * does not exist in this codebase yet, tracked as a separate follow-up, not invented here -- see
 * [org.pca.app.runtime.identity.DeviceIdentityProvider]'s own doc comment).
 */
class PersistentFamilyStateStore(
    private val store: PersistentStateStore,
    private val key: String = KEY,
) : FamilyStateStore {

    override fun currentState(): LocalFamilyState? {
        val raw = store.getString(key) ?: return null
        return decode(raw)
    }

    override fun save(state: LocalFamilyState) {
        store.putString(key, encode(state))
    }

    override fun clear() {
        store.remove(key)
    }

    internal fun encode(state: LocalFamilyState): String = listOf(
        state.familyId,
        state.deviceId,
        state.pairingState.name,
        state.trustSetEpoch.toString(),
        state.keyEpoch.toString(),
    ).joinToString(FIELD_SEPARATOR)

    internal fun decode(raw: String): LocalFamilyState? {
        val parts = raw.split(FIELD_SEPARATOR, limit = FIELD_COUNT)
        if (parts.size != FIELD_COUNT) return null
        return try {
            LocalFamilyState(
                familyId = parts[0],
                deviceId = parts[1],
                pairingState = PairingState.valueOf(parts[2]),
                trustSetEpoch = parts[3].toInt(),
                keyEpoch = parts[4].toInt(),
            )
        } catch (_: IllegalArgumentException) {
            // Malformed/corrupt persisted value -- fail safe to "no local family state" rather
            // than crash or fabricate an enrolled identity; callers (DeviceIdentityProvider) fall
            // back to their own NotEnrolled/unavailable handling from there.
            null
        }
    }

    private companion object {
        const val KEY = "family_state_v1"
        const val FIELD_SEPARATOR = "|"
        const val FIELD_COUNT = 5
    }
}
