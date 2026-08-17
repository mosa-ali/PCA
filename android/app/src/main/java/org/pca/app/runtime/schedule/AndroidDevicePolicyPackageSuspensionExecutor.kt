package org.pca.app.runtime.schedule

import android.app.admin.DevicePolicyManager
import android.content.Context

/**
 * Public Android package-suspension adapter. The caller gates this operation with the live
 * device-owner authority; this adapter does not cache or manufacture authority.
 */
class AndroidDevicePolicyPackageSuspensionExecutor(
    context: Context,
) : PackageSuspensionExecutor {
    private val devicePolicyManager = context.getSystemService(DevicePolicyManager::class.java)

    override fun setSuspended(packageName: String, suspended: Boolean): Boolean =
        runCatching {
            // A device owner may pass a null admin component. The live authority gate belongs to
            // DevicePolicyScheduleEnforcementConsumer, not to this thin platform adapter.
            devicePolicyManager?.setPackagesSuspended(null, arrayOf(packageName), suspended)?.isEmpty() == true
        }.getOrDefault(false)
}
