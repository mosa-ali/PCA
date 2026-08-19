package org.pca.app.platform

/** Doc 06 Section 4 (PCA-AND-001): display states for child-side protection posture. */
enum class ProtectionMode {
    STANDARD,
    PROTECTED,
    DEGRADED,
    AUTHORIZATION_REQUIRED,
    NOT_SUPPORTED,
}

/**
 * Determines the device's CURRENT protection mode by re-querying platform
 * state every call -- doc 06 Section 4 explicitly forbids caching this as
 * an app-level flag ("mode MUST be determined at runtime via
 * DevicePolicyManager.isDeviceOwnerApp/isProfileOwnerApp, never a
 * locally-cached flag"), since device-owner/profile-owner status can be
 * revoked outside the app's control (an MDM console action, a factory
 * reset, the user removing the app as device admin) and a cached flag
 * would let the app keep claiming a capability level it no longer has.
 *
 * Doc 06 Section 7: Protected Mode requires DEVICE-owner authority on a
 * fully-managed device specifically -- profile-owner authority alone is
 * Standard Mode with a limited additional surface, never full Protected
 * Mode (never marketed or treated as such).
 */
interface PlatformProtectionCapabilities {
    fun currentMode(): ProtectionMode
}

/** Reference implementation composing [DevicePolicyCapabilitySource] per doc 06 Section 7's authority mapping. */
class DevicePolicyProtectionCapabilities(
    private val devicePolicyCapabilitySource: DevicePolicyCapabilitySource,
) : PlatformProtectionCapabilities {
    private val trackedAuthority = devicePolicyCapabilitySource as? DevicePolicyAuthorityTracker

    override fun currentMode(): ProtectionMode = when {
        trackedAuthority != null -> when (trackedAuthority.currentState()) {
            TrackedDevicePolicyState.DEVICE_OWNER -> ProtectionMode.PROTECTED
            TrackedDevicePolicyState.DEVICE_OWNER_REVOKED -> ProtectionMode.DEGRADED
            TrackedDevicePolicyState.DEVICE_OWNER_UNVERIFIABLE -> ProtectionMode.DEGRADED
            TrackedDevicePolicyState.UNAVAILABLE -> ProtectionMode.NOT_SUPPORTED
            TrackedDevicePolicyState.PROFILE_OWNER,
            TrackedDevicePolicyState.STANDARD,
            -> ProtectionMode.STANDARD
        }
        else -> when (devicePolicyCapabilitySource.currentAuthority()) {
            ManagedDeviceAuthority.DEVICE_OWNER -> ProtectionMode.PROTECTED
            ManagedDeviceAuthority.UNAVAILABLE -> ProtectionMode.NOT_SUPPORTED
            ManagedDeviceAuthority.PROFILE_OWNER, ManagedDeviceAuthority.NONE -> ProtectionMode.STANDARD
        }
    }
}
