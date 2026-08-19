package org.pca.app.runtime.schedule

import android.content.Context
import android.os.Build
import android.telecom.TelecomManager
import android.provider.Telephony

/**
 * PCA-AND-003A: resolves communication surfaces from documented Android APIs. The resolver does
 * not assume an OEM dialer package and fails closed to the durable emergency baseline when an API
 * is unavailable or permission-gated. It only returns opaque tokens to the policy evaluator.
 */
class AndroidCommunicationSurfaceResolver(private val context: Context) {
    fun resolveCommunicationSurfaces(): CommunicationSafetySurfaceTokens {
        val telecomManager = context.getSystemService(TelecomManager::class.java)
        val defaultDialer = runCatching { telecomManager?.defaultDialerPackage }.getOrNull()
        val systemDialer = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            runCatching { telecomManager?.systemDialerPackage }.getOrNull()
        } else {
            null
        }
        val defaultSms = runCatching { Telephony.Sms.getDefaultSmsPackage(context) }.getOrNull()

        return EmergencyAccessFloor.resolveCommunicationSurfaces(
            systemDialerPackage = systemDialer,
            incomingCallPackage = defaultDialer,
            smsTransportPackage = defaultSms,
            emergencySurfacePackages = emptySet(),
        )
    }
}
