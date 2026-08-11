package org.pca.app.feature.wellbeing.model

/**
 * Ambient conditions read from the platform ports at the moment a [NudgeTrigger] fires. Nothing
 * here is activity history, screen content, keystrokes, camera, or message data (PCA-WELL-019) --
 * it is the minimal signal set needed to decide whether/how to nudge.
 *
 * [eligibleAppToken] is a stable *symbolic* identifier for the foreground/just-exited app (e.g. a
 * hash or an opaque catalogue key), never a human-readable app name -- this keeps the app identity
 * out of anything that might be logged (PCA-WELL-027).
 */
data class NudgeTriggerContext(
    val trigger: NudgeTrigger,
    val nowMonotonicNanos: Long,
    val eligibleAppToken: String?,
    val isScreenLocked: Boolean,
    val isEmergencyActive: Boolean,
    val isCallActive: Boolean,
    val isNavigationOrSafetyContextActive: Boolean,
    val isSchoolModeActive: Boolean,
    val isCriticalWarningActive: Boolean,
    val isDegradedOrErrorFlow: Boolean,
    val isBreakShieldActive: Boolean,
    val minuteOfDayForQuietHoursOnly: Int,
    val notificationsCapable: Boolean,
    val lockScreenNotificationsCapable: Boolean,
)
