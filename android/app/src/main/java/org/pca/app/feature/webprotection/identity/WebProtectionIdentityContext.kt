package org.pca.app.feature.webprotection.identity

import org.pca.app.feature.webprotection.policy.OpaqueFamilyId
import org.pca.app.feature.webprotection.safebrowser.OpaqueProfileId
import org.pca.app.runtime.identity.DeviceIdentityProvider
import org.pca.app.runtime.identity.DeviceIdentityState
import org.pca.app.storage.FamilyStateStore

/**
 * doc 13's "never use `familyId = ""`/`profileId = ""` as real authority" --
 * a single, explicit port every Safe Browser navigation-surface caller must
 * go through to obtain identity, so a blank/fabricated identity can
 * structurally never reach [org.pca.app.feature.webprotection.safebrowser.SafeBrowserNavigationPolicy].
 *
 * [WebProtectionIdentity.TrustedFamilyContextUnavailable] is a first-class,
 * honestly-surfaced outcome (mirrors [DeviceIdentityState.NotEnrolled]'s own
 * convention) -- callers must react to it explicitly (doc 14 Safe Limited
 * Mode) rather than substitute an empty string or a random id.
 */
sealed class WebProtectionIdentity {
    data class Trusted(
        val familyId: OpaqueFamilyId,
        val profileId: OpaqueProfileId,
        val deviceId: String,
    ) : WebProtectionIdentity()

    /** doc 13: family/profile context is not yet available (not enrolled, or FTS/family-sync crypto is not active) -- never evaluate family-scoped rules under a blank identity. */
    data object TrustedFamilyContextUnavailable : WebProtectionIdentity()
}

interface WebProtectionIdentityContextProvider {
    fun current(): WebProtectionIdentity
}

/**
 * Production binding: derives identity ONLY from this device's own existing,
 * trusted enrollment state -- [FamilyStateStore] (this device's local family
 * membership record) and [DeviceIdentityProvider] (this device's enrolled
 * device id). Never invents a family/profile id.
 *
 * PCA's current enrollment model is one profile per physical device (a
 * `LocalFamilyState` has exactly one `deviceId`, no separate profile
 * concept) -- [profileId] therefore honestly equals [deviceId] until a
 * multi-profile-per-device architecture is introduced; this is a documented
 * mapping of the existing model, not a fabricated value.
 */
class RealWebProtectionIdentityContextProvider(
    private val familyStateStore: FamilyStateStore,
    private val deviceIdentityProvider: DeviceIdentityProvider,
) : WebProtectionIdentityContextProvider {
    override fun current(): WebProtectionIdentity {
        val familyState = familyStateStore.currentState()
            ?: return WebProtectionIdentity.TrustedFamilyContextUnavailable
        // Coordinator correction: EnrollmentCoordinator.persistSuccess() currently persists
        // familyId = "" as an explicitly documented placeholder (the bootstrap response today
        // carries only deviceId/status, not a real family identifier) -- a non-null LocalFamilyState
        // therefore does NOT by itself mean a trusted family identity exists. A blank familyId must
        // never be treated as real authority (doc 13); `.isBlank()` also catches an all-whitespace
        // value, not just the exact empty string.
        if (familyState.familyId.isBlank()) return WebProtectionIdentity.TrustedFamilyContextUnavailable
        val enrolledDeviceId = (deviceIdentityProvider.currentIdentity() as? DeviceIdentityState.Enrolled)?.deviceId
            ?: return WebProtectionIdentity.TrustedFamilyContextUnavailable
        // Defensive consistency check: these two ports must agree on deviceId, or neither is trustworthy enough to evaluate family-scoped rules under.
        if (familyState.deviceId != enrolledDeviceId) return WebProtectionIdentity.TrustedFamilyContextUnavailable

        return WebProtectionIdentity.Trusted(
            familyId = familyState.familyId,
            profileId = enrolledDeviceId,
            deviceId = enrolledDeviceId,
        )
    }
}
