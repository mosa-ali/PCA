package org.pca.app.platform

/** Doc 06 Section 7: the three managed-device authority levels a device can be in. Deliberately a 3-way enum, never a boolean "isManaged" flag, so a caller can never collapse profile-owner and device-owner into one undifferentiated "managed" state. */
enum class ManagedDeviceAuthority { NONE, PROFILE_OWNER, DEVICE_OWNER }

/** Adapter over DevicePolicyManager -- the authority source [PlatformProtectionCapabilities] queries to distinguish Standard from Protected Mode. */
interface DevicePolicyCapabilitySource {
    fun currentAuthority(): ManagedDeviceAuthority
}
