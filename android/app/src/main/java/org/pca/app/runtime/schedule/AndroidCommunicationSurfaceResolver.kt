package org.pca.app.runtime.schedule

import android.content.Context
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
        val defaultSms = runCatching { Telephony.Sms.getDefaultSmsPackage(context) }.getOrNull()

        return EmergencyAccessFloor.resolveCommunicationSurfaces(
            incomingCallPackage = defaultDialer,
            smsTransportPackage = defaultSms,
            emergencySurfacePackages = emptySet(),
        )
    }
}
