package org.pca.app.platform

import android.app.admin.DevicePolicyManager
import android.content.Context

/**
 * Standard Mode / general implementation. Always re-queries
 * DevicePolicyManager live (doc 06 Section 4's anti-caching requirement) --
 * never stores the result.
 */
class StandardDevicePolicyCapabilitySource(private val context: Context) : DevicePolicyCapabilitySource {

    override fun currentAuthority(): ManagedDeviceAuthority {
        val dpm = context.getSystemService(Context.DEVICE_POLICY_SERVICE) as? DevicePolicyManager
            ?: return ManagedDeviceAuthority.NONE
        return when {
            dpm.isDeviceOwnerApp(context.packageName) -> ManagedDeviceAuthority.DEVICE_OWNER
            dpm.isProfileOwnerApp(context.packageName) -> ManagedDeviceAuthority.PROFILE_OWNER
            else -> ManagedDeviceAuthority.NONE
        }
    }
}
