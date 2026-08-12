package org.pca.app.runtime.wellbeing

import android.content.Context
import android.media.AudioManager
import org.pca.app.feature.screentime.engine.ScreenTimeMode
import org.pca.app.feature.screentime.engine.ScreenTimeState
import org.pca.app.feature.wellbeing.ports.SuppressionContextSource

/**
 * Production [SuppressionContextSource] closing the gap PCA-WELL-1 left for the Coordinator
 * (doc 35 PCA-WELL-014: ambient context that must never be overridden by a nudge).
 *
 * Deliberately conservative on the signals this lane has no legitimate, permission-free way to
 * observe (task Section 7: "do not request invasive data merely for nudges. No call content. No
 * phone-number storage."):
 *  - [isCallActive]: uses [AudioManager.getMode] == MODE_IN_COMMUNICATION / MODE_IN_CALL as a
 *    permission-free, content-free proxy for "a call is active" -- exactly the kind of "active
 *    call if available through permitted platform state" the brief allows, without requesting
 *    READ_PHONE_STATE or touching call content/numbers.
 *  - [isEmergencyActive]: reads PCA-3's own [ScreenTimeState.mode] (EMERGENCY_EXCEPTION) --
 *    read-only, same discipline as [RuntimeBreakStateSource].
 *  - [isNavigationOrSafetyContextActive], [isSchoolModeActive], [isCriticalWarningActive],
 *    [isDegradedOrErrorFlow]: no real platform signal exists for these yet anywhere in this
 *    codebase (no navigation/school-mode/critical-warning feature is composed by this worktree),
 *    so they conservatively report false rather than inventing a state this lane cannot actually
 *    observe -- matching the same boundary discipline as
 *    `NoOpWellbeingScheduleContextSource`/`NotReadyScheduleRuntimePort`. A Coordinator wiring a
 *    real signal for any of these should replace the corresponding lambda, not this class.
 */
class RuntimeSuppressionContextSource(
    context: Context,
    private val screenTimeStateSupplier: () -> ScreenTimeState,
) : SuppressionContextSource {
    private val audioManager = context.applicationContext.getSystemService(Context.AUDIO_SERVICE) as? AudioManager

    override fun isEmergencyActive(): Boolean = screenTimeStateSupplier().mode == ScreenTimeMode.EMERGENCY_EXCEPTION

    override fun isCallActive(): Boolean {
        val mode = audioManager?.mode ?: return false
        return mode == AudioManager.MODE_IN_CALL || mode == AudioManager.MODE_IN_COMMUNICATION
    }

    override fun isNavigationOrSafetyContextActive(): Boolean = false
    override fun isSchoolModeActive(): Boolean = false
    override fun isCriticalWarningActive(): Boolean = false
    override fun isDegradedOrErrorFlow(): Boolean = false
}
