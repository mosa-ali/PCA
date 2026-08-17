package org.pca.app.runtime.communication

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.telephony.PhoneStateListener
import android.telephony.TelephonyCallback
import android.telephony.TelephonyManager
import androidx.annotation.RequiresApi
import androidx.core.content.ContextCompat
import java.util.concurrent.Executor

/**
 * Android public-API call-state adapter for PCA-FR-043C/PCA-FR-015A.
 *
 * API 31+ uses [TelephonyCallback.CallStateListener]; older supported API levels use the public
 * [PhoneStateListener] equivalent. Registration is permission-gated, idempotent, and reversible.
 * The callback consumes only RINGING/OFFHOOK/IDLE, and deliberately ignores the legacy number
 * argument. If READ_PHONE_STATE is unavailable, the adapter remains inactive and PCA reports no
 * fabricated communication timing exception.
 */
class AndroidTelephonyCallStateObserver(
    context: Context,
    private val executor: Executor = ContextCompat.getMainExecutor(context),
) : CommunicationCallStateObserver {
    private val applicationContext = context.applicationContext
    private val telephonyManager = applicationContext.getSystemService(TelephonyManager::class.java)
    private var started = false
    private var modernCallback: TelephonyCallback? = null
    private var legacyListener: PhoneStateListener? = null

    @Synchronized
    override fun start(onState: (CommunicationExceptionCoordinator.CallState) -> Unit) {
        if (started || telephonyManager == null || !hasReadPhoneState()) return
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                registerModern(onState)
            } else {
                registerLegacy(onState)
            }
            started = true
        } catch (_: SecurityException) {
            modernCallback = null
            legacyListener = null
        }
    }

    @Synchronized
    override fun stop() {
        if (!started) return
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                modernCallback?.let { telephonyManager?.unregisterTelephonyCallback(it) }
            } else {
                @Suppress("DEPRECATION")
                legacyListener?.let { telephonyManager?.listen(it, PhoneStateListener.LISTEN_NONE) }
            }
        } catch (_: SecurityException) {
            // Permission revocation must not crash shutdown or leak PCA process state.
        } finally {
            modernCallback = null
            legacyListener = null
            started = false
        }
    }

    private fun hasReadPhoneState(): Boolean =
        ContextCompat.checkSelfPermission(applicationContext, Manifest.permission.READ_PHONE_STATE) ==
            PackageManager.PERMISSION_GRANTED

    @RequiresApi(Build.VERSION_CODES.S)
    private fun registerModern(onState: (CommunicationExceptionCoordinator.CallState) -> Unit) {
        val callback = object : TelephonyCallback(), TelephonyCallback.CallStateListener {
            override fun onCallStateChanged(state: Int) {
                onState(mapState(state))
            }
        }
        telephonyManager?.registerTelephonyCallback(executor, callback)
        modernCallback = callback
    }

    @Suppress("DEPRECATION")
    private fun registerLegacy(onState: (CommunicationExceptionCoordinator.CallState) -> Unit) {
        val listener = object : PhoneStateListener() {
            override fun onCallStateChanged(state: Int, phoneNumber: String?) {
                onState(mapState(state))
            }
        }
        telephonyManager?.listen(listener, PhoneStateListener.LISTEN_CALL_STATE)
        legacyListener = listener
    }

    private fun mapState(state: Int): CommunicationExceptionCoordinator.CallState = when (state) {
        TelephonyManager.CALL_STATE_RINGING -> CommunicationExceptionCoordinator.CallState.RINGING
        TelephonyManager.CALL_STATE_OFFHOOK -> CommunicationExceptionCoordinator.CallState.OFFHOOK
        else -> CommunicationExceptionCoordinator.CallState.IDLE
    }
}
