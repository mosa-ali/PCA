package org.pca.app.runtime.identity

import org.pca.app.storage.FamilyStateStore

/**
 * PCA-RUNTIME-2R1: the single authority for "what is this device's PCA-enrolled identity,"
 * deliberately separate from [org.pca.app.runtime.boot.BootInstanceSource] (which answers a
 * different question -- has the device rebooted -- and must never be reused for this one) and
 * from `Settings.Secure.ANDROID_ID` (a generic platform identifier this app must not treat as
 * proof of family enrollment, per doc PCA-DATA-012's "deviceId is opaque" contract -- the actual
 * enrolled id is issued server-side at enrollment, see `backend/src/enrollment/EnrollmentCoordinator.ts`).
 *
 * [DeviceIdentityState.NotEnrolled] is a first-class, honestly-surfaced outcome, not an error to
 * paper over with a fabricated id: a device that has not completed enrollment genuinely has no
 * PCA device identity yet. Callers that need one (usage/location ownership) must handle
 * [DeviceIdentityState.NotEnrolled] explicitly (skip recording under a made-up id) rather than
 * substitute a random UUID or a platform identifier -- doing so would silently misattribute
 * local records to an identity nothing on the family side actually recognizes.
 */
sealed interface DeviceIdentityState {
    data class Enrolled(val deviceId: String) : DeviceIdentityState
    data object NotEnrolled : DeviceIdentityState
}

interface DeviceIdentityProvider {
    fun currentIdentity(): DeviceIdentityState
}

/**
 * Production binding: reads whatever [org.pca.app.storage.LocalFamilyState] this device has
 * durably persisted from its own enrollment (via [FamilyStateStore]) and reports its `deviceId`
 * when present. This class does not perform enrollment itself and does not fabricate an id when
 * none has been persisted yet -- it only reads the one existing local authority for "am I
 * enrolled, and if so, as what."
 *
 * KNOWN_ARCHITECTURE_GAP (reported to the Coordinator, not silently worked around): no production
 * code path in this repository currently calls the backend enrollment endpoint and writes its
 * result into [FamilyStateStore] -- `org.pca.app.enrollment.DeviceBootstrapApiClient` is a
 * contract with no concrete implementation, and nothing in `PcaAppGraph` constructs or saves to a
 * [FamilyStateStore] today. Building that HTTP-calling implementation is a distinct enrollment
 * feature, not this narrow correction's job (it would require the same production-crypto/session
 * plumbing every other signed-in-family-content path already defers pending
 * `PRODUCTION_CRYPTO_SUITE` human security review). Until it exists, every device honestly
 * reports [DeviceIdentityState.NotEnrolled] in production -- correct and expected, not a bug.
 */
class PersistentDeviceIdentityProvider(private val familyStateStore: FamilyStateStore) : DeviceIdentityProvider {
    override fun currentIdentity(): DeviceIdentityState {
        val deviceId = familyStateStore.currentState()?.deviceId
        return if (deviceId != null) DeviceIdentityState.Enrolled(deviceId) else DeviceIdentityState.NotEnrolled
    }
}
