package org.pca.app.storage

import org.pca.app.enrollment.PairingState
import org.pca.app.enrollment.AgeUxTier
import org.pca.app.enrollment.InitialPolicyProfile

/**
 * This device's locally-persisted view of its own family membership --
 * deliberately minimal (opaque ids, lifecycle state, and epoch counters
 * only; no policy or activity content, which lives in [EncryptedVault]
 * once FDEK decryption exists, a later, crypto-suite-gated concern).
 */
data class LocalFamilyState(
    val familyId: String,
    val deviceId: String,
    val pairingState: PairingState,
    val trustSetEpoch: Int,
    val keyEpoch: Int,
    val childProfileId: String? = null,
    val ageUxTier: AgeUxTier = AgeUxTier.YOUNG_CHILD,
    val initialPolicyProfile: InitialPolicyProfile = InitialPolicyProfile.BALANCED,
)

interface FamilyStateStore {
    fun currentState(): LocalFamilyState?
    fun save(state: LocalFamilyState)
    fun clear()
}

/** In-memory reference FamilyStateStore -- real and usable for composition/dev builds, not durable across process death. */
class InMemoryFamilyStateStore : FamilyStateStore {
    private var state: LocalFamilyState? = null

    override fun currentState(): LocalFamilyState? = state
    override fun save(state: LocalFamilyState) { this.state = state }
    override fun clear() { state = null }
}
