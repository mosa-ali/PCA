package org.pca.app.storage

import org.json.JSONObject
import org.pca.app.enrollment.PairingState
import org.pca.app.enrollment.AgeUxTier
import org.pca.app.enrollment.InitialPolicyProfile
import org.pca.app.foundation.PersistentStateStore
import org.pca.app.runtime.EpochBounds

/**
 * Durable binding for [FamilyStateStore], backed by the OS-protected [PersistentStateStore].
 * New records use a versioned JSON key so opaque identifiers round-trip without delimiter rules;
 * the original separator-delimited key remains readable for migration. This class only persists
 * state supplied by enrollment and does not perform enrollment or contact the backend.
 */
class PersistentFamilyStateStore(
    private val store: PersistentStateStore,
    private val key: String = KEY,
) : FamilyStateStore {

    override fun currentState(): LocalFamilyState? = currentState { }

    /**
     * The optional hook is internal for deterministic interleaving tests.
     * The production overload supplies no callback. Keep both versioned and
     * legacy reads inside one backing-store critical section so clear/save
     * cannot split the fallback decision.
     */
    internal fun currentState(afterVersionedRead: () -> Unit): LocalFamilyState? = synchronized(store.coordinationLock) {
        // DurableEnrollmentStorage.read synchronizes on this same monitor;
        // JVM monitors are reentrant, so this outer section remains held
        // across both nested reads and the fallback decision.
        val currentRaw = DurableEnrollmentStorage.read(store, versionedKey)
        afterVersionedRead()
        if (currentRaw != null) {
            if (currentRaw == CLEARED_V2) return@synchronized null
            return@synchronized decodeVersioned(currentRaw)
        }
        val legacyRaw = DurableEnrollmentStorage.read(store, key) ?: return@synchronized null
        decodeLegacy(legacyRaw)
    }

    override fun save(state: LocalFamilyState) {
        require(state.deviceId.isNotBlank()) { "deviceId must not be blank." }
        EpochBounds.requireValid(state.trustSetEpoch, "trustSetEpoch")
        EpochBounds.requireValid(state.keyEpoch, "keyEpoch")
        DurableEnrollmentStorage.write(store, versionedKey, encodeVersioned(state))
    }

    override fun clear() {
        // A tombstone prevents an old v1 value from reappearing after process death.
        DurableEnrollmentStorage.write(store, versionedKey, CLEARED_V2)
    }

    private fun encodeVersioned(state: LocalFamilyState): String = JSONObject()
        .put("version", VERSION_2)
        .put("familyId", state.familyId)
        .put("deviceId", state.deviceId)
        .put("pairingState", state.pairingState.name)
        .put("trustSetEpoch", state.trustSetEpoch)
        .put("keyEpoch", state.keyEpoch)
        .put("childProfileId", state.childProfileId?.takeIf { it.isNotBlank() } ?: JSONObject.NULL)
        .put("ageUxTier", state.ageUxTier.name)
        .put("initialPolicyProfile", state.initialPolicyProfile.name)
        .toString()

    private fun decodeVersioned(raw: String): LocalFamilyState = try {
        val json = JSONObject(raw)
        require(json.keys().asSequence().toSet() == VERSION_2_KEYS)
        require(json.get("version") == VERSION_2)
        fun string(name: String): String = json.get(name) as? String ?: error("invalid_family_state")
        val childProfileId = when (val value = json.get("childProfileId")) {
            JSONObject.NULL -> null
            is String -> value.takeIf { it.isNotBlank() } ?: error("invalid_family_state")
            else -> error("invalid_family_state")
        }
        val deviceId = string("deviceId")
        require(deviceId.isNotBlank())
        LocalFamilyState(
            familyId = string("familyId"),
            deviceId = deviceId,
            pairingState = PairingState.valueOf(string("pairingState")),
            trustSetEpoch = EpochBounds.decodeJson(json, "trustSetEpoch"),
            keyEpoch = EpochBounds.decodeJson(json, "keyEpoch"),
            childProfileId = childProfileId,
            ageUxTier = AgeUxTier.valueOf(string("ageUxTier")),
            initialPolicyProfile = InitialPolicyProfile.valueOf(string("initialPolicyProfile")),
        )
    } catch (_: Exception) {
        throw CorruptLocalFamilyStateException()
    }

    /** Decode the unversioned separator format written by earlier app versions. */
    private fun decodeLegacy(raw: String): LocalFamilyState {
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
            if (parts[1].isBlank()) throw CorruptLocalFamilyStateException()
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
        const val VERSIONED_KEY_SUFFIX = ".v2"
        const val VERSION_2 = 2
        const val CLEARED_V2 = "family-state-cleared-v2"
        const val FIELD_SEPARATOR = "|"
        const val LEGACY_FIELD_COUNT = 5
        const val FIELD_COUNT = 8
        val VERSION_2_KEYS = setOf(
            "version", "familyId", "deviceId", "pairingState", "trustSetEpoch", "keyEpoch",
            "childProfileId", "ageUxTier", "initialPolicyProfile",
        )
    }

    private val versionedKey: String
        get() = "$key$VERSIONED_KEY_SUFFIX"
}
