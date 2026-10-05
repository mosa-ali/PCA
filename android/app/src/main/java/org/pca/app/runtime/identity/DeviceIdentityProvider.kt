package org.pca.app.runtime.identity

import org.pca.app.storage.CorruptLocalFamilyStateException
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
 * PCA device identity yet. [DeviceIdentityState.Unavailable] is separate and means persisted
 * identity could not be trusted. Callers that need an identity (usage/location ownership) must
 * handle both by skipping family-scoped work, never substituting a random UUID or a platform
 * identifier that the family side does not recognize.
 */
sealed interface DeviceIdentityState {
    data class Enrolled(val deviceId: String) : DeviceIdentityState
    data object NotEnrolled : DeviceIdentityState
    /** A persisted record exists but is unreadable, so this device cannot safely claim an identity or first-install status. */
    data object Unavailable : DeviceIdentityState
}

interface DeviceIdentityProvider {
    fun currentIdentity(): DeviceIdentityState
}

/**
 * Production binding: reads whatever [org.pca.app.storage.LocalFamilyState] this device has
 * durably persisted from its own enrollment (via [FamilyStateStore]) and reports its `deviceId`
 * when present. This class does not perform enrollment itself and does not fabricate an id when
 * none has been persisted yet -- it only reads the one existing local authority for "am I
 * enrolled, and if so, as what." Corrupt persisted data is surfaced as [DeviceIdentityState.Unavailable],
 * never as first-install [DeviceIdentityState.NotEnrolled].
 *
 * CLOSED (was KNOWN_ARCHITECTURE_GAP): `PcaAppGraph` now constructs a real
 * `org.pca.app.enrollment.HttpDeviceBootstrapApiClient` and wires it through
 * `EnrollmentCoordinator` into a real `PersistentFamilyStateStore` -- this class genuinely reads
 * that store's current state, not a permanently-empty one. Device key generation upstream of this
 * (`NotApprovedDeviceKeyPairGenerator`) remains intentionally fail-closed pending
 * `PRODUCTION_CRYPTO_SUITE` human security review, so a real enrollment attempt still stops before
 * reaching this class in practice today -- that is a separate, deliberate gate, not a defect in
 * this provider or in the wiring itself.
 */
class PersistentDeviceIdentityProvider(private val familyStateStore: FamilyStateStore) : DeviceIdentityProvider {
    override fun currentIdentity(): DeviceIdentityState {
        val state = try {
            familyStateStore.currentState()
        } catch (_: CorruptLocalFamilyStateException) {
            return DeviceIdentityState.Unavailable
        }
        val deviceId = state?.deviceId
        return if (deviceId != null) DeviceIdentityState.Enrolled(deviceId) else DeviceIdentityState.NotEnrolled
    }
}
