package org.pca.app.feature.wellbeing.ports

import android.app.KeyguardManager
import android.content.Context
import androidx.core.app.NotificationManagerCompat
import java.util.Calendar

/**
 * Concrete, self-contained adapters for the ports that need nothing beyond a [Context] -- no
 * cross-feature/shared-DI wiring required, so these ship as real implementations rather than
 * being left to the Coordinator integration queue. [EligibleAppSignalSource], [SuppressionContextSource],
 * and [BreakStateSource] are NOT provided here: they genuinely need to observe PCA-3/PCA-4/other
 * lanes' live state (usage visibility, call state, break-shield state), which is exactly the kind
 * of cross-feature wiring doc 35 defers to the Coordinator rather than reaching into another
 * lane's code from this worktree.
 */
class StandardScreenLockStateSource(private val context: Context) : ScreenLockStateSource {
    override fun isScreenLocked(): Boolean {
        val keyguard = context.getSystemService(Context.KEYGUARD_SERVICE) as? KeyguardManager ?: return false
        return keyguard.isKeyguardLocked
    }
}

class StandardNotificationCapabilitySource(private val context: Context) : NotificationCapabilitySource {
    override fun notificationsEnabled(): Boolean = NotificationManagerCompat.from(context).areNotificationsEnabled()

    // BEST_EFFORT by design (doc 35): this module cannot know in advance whether a given secure
    // lock screen will actually render the notification (OEM skins, user "hide sensitive content"
    // settings). It only reports whether ordinary notifications are enabled at all; the eventual
    // lock-screen rendering decision always remains with the OS.
    override fun lockScreenNotificationsAvailable(): Boolean = notificationsEnabled()
}

class StandardWallClockCalendarSource : WallClockCalendarSource {
    override fun minuteOfDay(): Int {
        val cal = Calendar.getInstance()
        return cal.get(Calendar.HOUR_OF_DAY) * 60 + cal.get(Calendar.MINUTE)
    }
}
