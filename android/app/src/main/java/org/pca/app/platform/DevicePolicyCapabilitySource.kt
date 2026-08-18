package org.pca.app.platform

/**
 * Doc 06 Section 7: the managed-device authority levels that this adapter can
 * prove. [UNAVAILABLE] is distinct from [NONE]: a missing system service is
 * not evidence that the app is in Standard Mode.
 */
enum class ManagedDeviceAuthority { NONE, PROFILE_OWNER, DEVICE_OWNER, UNAVAILABLE }

/** Adapter over DevicePolicyManager -- the authority source [PlatformProtectionCapabilities] queries to distinguish Standard from Protected Mode. */
interface DevicePolicyCapabilitySource {
    fun currentAuthority(): ManagedDeviceAuthority
}

/**
 * History-aware, fail-closed view used by the runtime status and tamper paths.
 * The tracker only upgrades to [DEVICE_OWNER] after a live
 * `DevicePolicyManager.isDeviceOwnerApp` observation and reports a later loss
 * as [DEVICE_OWNER_REVOKED]. It never infers Protected Mode from a stored flag.
 */
enum class TrackedDevicePolicyState {
    DEVICE_OWNER,
    PROFILE_OWNER,
    STANDARD,
    DEVICE_OWNER_REVOKED,
    UNAVAILABLE,
}

class DevicePolicyAuthorityTracker(
    private val source: DevicePolicyCapabilitySource,
) : DevicePolicyCapabilitySource {
    private var everObservedDeviceOwner = false

    @Synchronized
    override fun currentAuthority(): ManagedDeviceAuthority {
        val authority = source.currentAuthority()
        if (authority == ManagedDeviceAuthority.DEVICE_OWNER) {
            everObservedDeviceOwner = true
        }
        return authority
    }

    @Synchronized
    fun currentState(): TrackedDevicePolicyState = when (currentAuthority()) {
        ManagedDeviceAuthority.DEVICE_OWNER -> TrackedDevicePolicyState.DEVICE_OWNER
        ManagedDeviceAuthority.PROFILE_OWNER ->
            if (everObservedDeviceOwner) TrackedDevicePolicyState.DEVICE_OWNER_REVOKED
            else TrackedDevicePolicyState.PROFILE_OWNER
        ManagedDeviceAuthority.NONE ->
            if (everObservedDeviceOwner) TrackedDevicePolicyState.DEVICE_OWNER_REVOKED
            else TrackedDevicePolicyState.STANDARD
        ManagedDeviceAuthority.UNAVAILABLE -> TrackedDevicePolicyState.UNAVAILABLE
    }
}
