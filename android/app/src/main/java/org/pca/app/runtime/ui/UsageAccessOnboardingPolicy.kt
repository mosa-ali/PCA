package org.pca.app.runtime.ui

import org.pca.app.platform.UsageAccessState

/**
 * PCA-FR-081 / doc 06 onboarding gap closure: the pure decision policy behind the one user-facing
 * flow that can actually get `PACKAGE_USAGE_STATS` granted.
 *
 * The manifest has always DECLARED that permission (see `AndroidManifest.xml`'s own note), and
 * [org.pca.app.platform.StandardUsageObservationSource.accessState] has always CHECKED it via
 * AppOps -- but nothing in the app ever sent the parent to
 * [android.provider.Settings.ACTION_USAGE_ACCESS_SETTINGS], the manual per-user toggle that is the
 * ONLY way this signature-level special access is ever granted. On a fresh install that left screen
 * time, Break Shield, wellbeing eligibility and YouTube Mode A duration all reading a
 * permanently-empty event list on a real device, with no disclosure and no way to fix it.
 *
 * Deliberately shaped exactly like [CallStatePermissionPromptPolicy]: a pure, framework-free object
 * so the decision is unit-testable without an Android runtime, with [MainActivity] owning only the
 * `startActivity`/state-refresh side effects. Unlike the call-state policy there is no `REQUEST`
 * action -- usage access has no runtime-permission dialog at all, only the Settings hand-off.
 *
 * Never fabricates a grant: [Action.UNAVAILABLE_ON_DEVICE] is returned when the platform itself
 * did not provide `AppOpsManager` ([UsageAccessState.UNAVAILABLE]), because on such a device the
 * Settings screen this policy would otherwise send the user to does not resolve either. The caller
 * must render that as an honest "unavailable on this device", never as a pending action.
 */
object UsageAccessOnboardingPolicy {
    enum class Action { ALREADY_GRANTED, OPEN_USAGE_ACCESS_SETTINGS, UNAVAILABLE_ON_DEVICE }

    fun nextAction(state: UsageAccessState): Action = when (state) {
        UsageAccessState.GRANTED -> Action.ALREADY_GRANTED
        UsageAccessState.DENIED, UsageAccessState.NOT_CONFIGURED -> Action.OPEN_USAGE_ACCESS_SETTINGS
        UsageAccessState.UNAVAILABLE -> Action.UNAVAILABLE_ON_DEVICE
    }

    /**
     * True only for a state in which the usage-derived capabilities (screen time, Break Shield,
     * wellbeing eligibility, YouTube duration) genuinely read real data. Every non-GRANTED state
     * -- including NOT_CONFIGURED, the fresh-install default -- is capability-unavailable and must
     * be shown as such; falling closed here is what stops the UI implying a feature works while
     * `queryEventsSince` returns an empty list forever.
     */
    fun isCapabilityUsable(state: UsageAccessState): Boolean = state == UsageAccessState.GRANTED

    /** Re-reads live state only when a Settings round-trip actually changed denied to granted --
     * identical contract to [CallStatePermissionPromptPolicy.shouldRefreshAfterSettingsReturn]. */
    fun shouldRefreshAfterSettingsReturn(wasGranted: Boolean, isGranted: Boolean): Boolean =
        !wasGranted && isGranted
}
