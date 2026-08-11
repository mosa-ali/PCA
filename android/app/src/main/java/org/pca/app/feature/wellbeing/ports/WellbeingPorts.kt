package org.pca.app.feature.wellbeing.ports

/**
 * Narrow platform ports (doc 35): PCA-WELL-1 consumes existing PCA-3/PCA-4 signals through these
 * seams instead of duplicating a screen-time or usage-tracking engine. A Coordinator-level adapter
 * is expected to wire the real implementations against PCA-3's `ScreenTimeEngine`/`UsageObservationSource`
 * and PCA-4's app-usage visibility; the trigger dispatcher in this module only depends on these
 * interfaces, so it compiles and is fully unit-testable without either.
 */

/** Whether the currently (or just previously) foreground app is one the family policy has marked
 * "eligible" for wellbeing nudging (high-engagement apps, e.g. games) -- backed by PCA-4 usage
 * visibility. Returns a stable symbolic token, never a human-readable app name (PCA-WELL-027). */
interface EligibleAppSignalSource {
    fun currentEligibleAppToken(): String?
}

/** Screen lock/unlock state -- best effort, degrades to LIMITED gracefully (doc 35). */
interface ScreenLockStateSource {
    fun isScreenLocked(): Boolean
}

/** Whether ordinary / lock-screen notifications can currently be posted. */
interface NotificationCapabilitySource {
    fun notificationsEnabled(): Boolean
    fun lockScreenNotificationsAvailable(): Boolean
}

/** Suppression-relevant ambient context that must never be overridden by a nudge (PCA-WELL-014). */
interface SuppressionContextSource {
    fun isEmergencyActive(): Boolean
    fun isCallActive(): Boolean
    fun isNavigationOrSafetyContextActive(): Boolean
    fun isSchoolModeActive(): Boolean
    fun isCriticalWarningActive(): Boolean
    fun isDegradedOrErrorFlow(): Boolean
}

/** Read-only view of PCA-3's break-shield state -- never mutated by this module (PCA-WELL-024). */
interface BreakStateSource {
    fun isBreakShieldActive(): Boolean
}

/** Minute-of-day (device-local wall clock, display/scheduling only -- never elapsed-time math). */
interface WallClockCalendarSource {
    fun minuteOfDay(): Int
}
