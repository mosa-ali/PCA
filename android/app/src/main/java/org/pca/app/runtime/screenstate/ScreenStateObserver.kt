package org.pca.app.runtime.screenstate

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.PowerManager
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import org.pca.app.feature.wellbeing.ports.ScreenLockStateSource

/**
 * Correction round Section 2/3: real, documented device screen-use signal, used to drive
 * [org.pca.app.runtime.PcaRuntime.pauseScreenTime]/[org.pca.app.runtime.PcaRuntime.resumeScreenTime]
 * so the (already-verified-correct) 60/30 [org.pca.app.feature.screentime.engine.ScreenTimeEngine]
 * state machine actually reflects real screen use rather than free-running on Tick alone.
 *
 * Built entirely from documented Android mechanisms: dynamically registered
 * `ACTION_SCREEN_ON`/`ACTION_SCREEN_OFF`/`ACTION_USER_PRESENT` broadcasts (the standard way to
 * observe screen-interactive/keyguard transitions since these are protected, non-manifest-
 * deliverable broadcasts) plus [PowerManager.isInteractive] and the already-accepted
 * [ScreenLockStateSource] (`isKeyguardLocked`) for the initial/on-transition snapshot. No
 * `AccessibilityService`, no foreground-app monitoring, no network signal.
 */
interface ScreenStateObserver {
    /** Cold flow of qualifying-use transitions: `true` = screen interactive AND not locked
     * (qualifying active use), `false` = screen off OR locked (non-qualifying, should pause). */
    fun observe(): Flow<Boolean>

    fun isCurrentlyActive(): Boolean
}

class AndroidScreenStateObserver(
    private val context: Context,
    private val screenLockStateSource: ScreenLockStateSource,
) : ScreenStateObserver {

    override fun observe(): Flow<Boolean> = callbackFlow {
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(receiverContext: Context, intent: Intent) {
                when (intent.action) {
                    // Screen off is unconditionally non-qualifying -- no ambiguity, no need to
                    // consult the keyguard state.
                    Intent.ACTION_SCREEN_OFF -> trySend(false)
                    // Screen just turned on: if a secure lock is configured, the keyguard is
                    // showing and this is NOT yet qualifying use -- ACTION_USER_PRESENT (below)
                    // is what actually confirms the child unlocked it. If no lock is configured,
                    // the screen turning on already IS qualifying use.
                    Intent.ACTION_SCREEN_ON -> trySend(!screenLockStateSource.isScreenLocked())
                    // The keyguard was just dismissed -- unambiguously qualifying use resuming.
                    Intent.ACTION_USER_PRESENT -> trySend(true)
                }
            }
        }
        val filter = IntentFilter().apply {
            addAction(Intent.ACTION_SCREEN_OFF)
            addAction(Intent.ACTION_SCREEN_ON)
            addAction(Intent.ACTION_USER_PRESENT)
        }
        context.registerReceiver(receiver, filter)
        trySend(isCurrentlyActive())
        awaitClose { context.unregisterReceiver(receiver) }
    }.distinctUntilChanged()

    override fun isCurrentlyActive(): Boolean {
        val powerManager = context.getSystemService(Context.POWER_SERVICE) as? PowerManager
        val screenInteractive = powerManager?.isInteractive ?: true
        return screenInteractive && !screenLockStateSource.isScreenLocked()
    }
}
