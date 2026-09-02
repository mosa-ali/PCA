package org.pca.app.runtime.ui

/**
 * PCA-WELL-012 / PCA-FR-073 / PCA-FR-081 onboarding gap closure: the pure decision policy behind
 * the one user-facing flow that can actually get `POST_NOTIFICATIONS` granted.
 *
 * The manifest has always DECLARED `POST_NOTIFICATIONS`, and every delivery site in the app already
 * guards its `notify()` call on it (`WellbeingNotificationDelivery`, `PrayerReminderReceiver`,
 * `UsageAccessAlertNotificationDelivery`, `PrayerLocationStalenessNotificationDelivery`) -- but
 * nothing ever REQUESTED it at runtime. On API 33+ that permission defaults to denied, so every one
 * of those guards evaluated false forever and each notification-delivered feature was inert while
 * still appearing wired.
 *
 * Shaped exactly like [CallStatePermissionPromptPolicy] (one-shot runtime request, then a Settings
 * hand-off once the OS stops showing the dialog), with one addition: the decision is driven by
 * `notificationsEnabled` -- the live [androidx.core.app.NotificationManagerCompat.areNotificationsEnabled]
 * answer already exposed as
 * [org.pca.app.runtime.status.PcaRuntimeStatus.wellbeingNotificationsAvailable] -- rather than by
 * the permission grant alone. That is the honest end-state signal: on API 33+ it is false whenever
 * the runtime permission is denied, and below API 33 (where `POST_NOTIFICATIONS` does not exist and
 * there is nothing to request) it still correctly reports a user-disabled notification channel,
 * whose only remedy is the same Settings hand-off.
 */
object NotificationPermissionPromptPolicy {
    /** API level at which `POST_NOTIFICATIONS` became a runtime permission (Android 13). */
    const val RUNTIME_PERMISSION_MIN_SDK: Int = 33

    enum class Action { ALREADY_ENABLED, REQUEST_RUNTIME_PERMISSION, OPEN_SETTINGS }

    fun nextAction(sdkInt: Int, notificationsEnabled: Boolean, promptWasShown: Boolean): Action = when {
        notificationsEnabled -> Action.ALREADY_ENABLED
        sdkInt >= RUNTIME_PERMISSION_MIN_SDK && !promptWasShown -> Action.REQUEST_RUNTIME_PERMISSION
        // Below API 33 there is no runtime dialog to show, and on API 33+ once the one-shot dialog
        // has been shown and denied the OS silently no-ops any further request -- in both cases the
        // app-notification Settings screen is the only real remedy, never a second dialog attempt.
        else -> Action.OPEN_SETTINGS
    }

    /** Re-reads live state only when a Settings round-trip actually changed disabled to enabled --
     * identical contract to [CallStatePermissionPromptPolicy.shouldRefreshAfterSettingsReturn]. */
    fun shouldRefreshAfterSettingsReturn(wasEnabled: Boolean, isEnabled: Boolean): Boolean =
        !wasEnabled && isEnabled
}
