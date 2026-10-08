package org.pca.app.storage

import org.pca.app.enrollment.PairingState
import org.pca.app.enrollment.AgeUxTier
import org.pca.app.enrollment.InitialPolicyProfile
import org.pca.app.foundation.PersistentStateStore
import org.pca.app.runtime.EpochBounds

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
        val raw = DurableEnrollmentStorage.read(store, key) ?: return null
        return decode(raw)
    }

    override fun save(state: LocalFamilyState) {
        EpochBounds.requireValid(state.trustSetEpoch, "trustSetEpoch")
        EpochBounds.requireValid(state.keyEpoch, "keyEpoch")
        DurableEnrollmentStorage.write(store, key, encode(state))
    }

    override fun clear() {
        DurableEnrollmentStorage.write(store, key, null)
    }

    internal fun encode(state: LocalFamilyState): String = listOf(
        state.familyId,
        state.deviceId,
        state.pairingState.name,
        state.trustSetEpoch.toString(),
        state.keyEpoch.toString(),
        state.childProfileId.orEmpty(),
        state.ageUxTier.name,
        state.initialPolicyProfile.name,
    ).joinToString(FIELD_SEPARATOR)

    internal fun decode(raw: String): LocalFamilyState {
        val parts = raw.split(FIELD_SEPARATOR, limit = FIELD_COUNT)
        if (parts.size != LEGACY_FIELD_COUNT && parts.size != FIELD_COUNT) {
            throw CorruptLocalFamilyStateException()
        }
        return try {
            val legacy = parts.size == LEGACY_FIELD_COUNT
            val trustSetEpoch = parts[3].toInt()
            val keyEpoch = parts[4].toInt()
            if (!EpochBounds.isValid(trustSetEpoch) || !EpochBounds.isValid(keyEpoch)) {
                throw CorruptLocalFamilyStateException()
            }
            LocalFamilyState(
                familyId = parts[0],
                deviceId = parts[1],
                pairingState = PairingState.valueOf(parts[2]),
                trustSetEpoch = trustSetEpoch,
                keyEpoch = keyEpoch,
                childProfileId = if (legacy || parts[5].isBlank()) null else parts[5],
                ageUxTier = if (legacy) AgeUxTier.YOUNG_CHILD else AgeUxTier.valueOf(parts[6]),
                initialPolicyProfile = if (legacy) InitialPolicyProfile.BALANCED else InitialPolicyProfile.valueOf(parts[7]),
            )
        } catch (_: IllegalArgumentException) {
            // Preserve the distinction between an absent first-install value and data that exists
            // but cannot establish a trustworthy local identity. Never erase or rewrite it here.
            throw CorruptLocalFamilyStateException()
        }
    }

    private companion object {
        const val KEY = "family_state_v1"
        const val FIELD_SEPARATOR = "|"
        const val LEGACY_FIELD_COUNT = 5
        const val FIELD_COUNT = 8
    }
}
