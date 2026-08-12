package org.pca.app.feature.wellbeing.policy

import org.pca.app.feature.wellbeing.model.NudgeTrigger

/**
 * The single explicit mapping layer between the parent-SDK's [SdkWellbeingTrigger] (types.ts,
 * doc 36 section 5.3) and the Android runtime's [NudgeTrigger] (doc 35 PCA-WELL-009). Mapped by
 * *meaning*, not position/count -- see doc 38 for the full table. Both sides have exactly one
 * concept the other lacks; both are resolved explicitly rather than silently dropped:
 *
 * - SDK `BREAK_ACTIVE` (a message eligible for the whole duration a break is in progress) has no
 *   Android trigger equivalent: Android does not fire a discrete "still on break" trigger --
 *   instead it tracks `isBreakShieldActive` as *context* on whichever trigger is being evaluated,
 *   and chooses `BREAK_SHIELD_CARD` as the delivery surface when it's true. The closest and only
 *   sensible Android trigger channel for `BREAK_ACTIVE` content is therefore
 *   [NudgeTrigger.BREAK_STARTED] (the discrete event Android fires when a break begins, which is
 *   also when break-shield delivery starts being considered) -- a deliberate, documented lossy
 *   mapping, not a silent drop.
 * - Android `SCREEN_LOCKED_BEST_EFFORT` (deliver a best-effort lock-screen notification) has no
 *   SDK trigger equivalent: the SDK models "may this appear on the lock screen" as a *delivery*
 *   concern (`DeliveryPolicy.lockScreenAllowed`), not a trigger. A parent-authored message never
 *   arrives with this as one of its `triggers`; Android's own runtime dispatch produces this
 *   trigger locally, independent of parent policy, and the adapter never needs to originate it.
 * - `SCHEDULED_TIME` (SDK) and `PARENT_SCHEDULED` (Android) are the same concept ("a parent set a
 *   fixed time-based nudge") under different naming and map 1:1.
 */
object TriggerMapping {

    private val SDK_TO_ANDROID: Map<SdkWellbeingTrigger, NudgeTrigger> = mapOf(
        SdkWellbeingTrigger.PERIODIC to NudgeTrigger.PERIODIC_HIGH_ENGAGEMENT_USE,
        SdkWellbeingTrigger.AFTER_UNLOCK to NudgeTrigger.AFTER_SCREEN_UNLOCK,
        SdkWellbeingTrigger.RAPID_GAME_RETURN to NudgeTrigger.IMMEDIATE_APP_RETURN,
        SdkWellbeingTrigger.BREAK_STARTED to NudgeTrigger.BREAK_STARTED,
        // Documented lossy mapping -- see class doc.
        SdkWellbeingTrigger.BREAK_ACTIVE to NudgeTrigger.BREAK_STARTED,
        SdkWellbeingTrigger.BREAK_COMPLETED to NudgeTrigger.BREAK_COMPLETED,
        SdkWellbeingTrigger.LONG_SESSION_ENDED to NudgeTrigger.LONG_SESSION_ENDED,
        SdkWellbeingTrigger.SCHEDULED_TIME to NudgeTrigger.PARENT_SCHEDULED,
        SdkWellbeingTrigger.CHILD_REQUESTED_IDEA to NudgeTrigger.CHILD_REQUESTED_IDEA,
    )

    /** Always total -- every [SdkWellbeingTrigger] has exactly one Android trigger channel. */
    fun toAndroid(trigger: SdkWellbeingTrigger): NudgeTrigger = SDK_TO_ANDROID.getValue(trigger)

    /** Null only for [NudgeTrigger.SCREEN_LOCKED_BEST_EFFORT], the one Android trigger with no SDK
     * equivalent (see class doc) -- a parent-authored message can never legitimately declare it. */
    fun toSdkOrNull(trigger: NudgeTrigger): SdkWellbeingTrigger? = when (trigger) {
        NudgeTrigger.PERIODIC_HIGH_ENGAGEMENT_USE -> SdkWellbeingTrigger.PERIODIC
        NudgeTrigger.AFTER_SCREEN_UNLOCK -> SdkWellbeingTrigger.AFTER_UNLOCK
        NudgeTrigger.IMMEDIATE_APP_RETURN -> SdkWellbeingTrigger.RAPID_GAME_RETURN
        NudgeTrigger.BREAK_STARTED -> SdkWellbeingTrigger.BREAK_STARTED
        NudgeTrigger.BREAK_COMPLETED -> SdkWellbeingTrigger.BREAK_COMPLETED
        NudgeTrigger.LONG_SESSION_ENDED -> SdkWellbeingTrigger.LONG_SESSION_ENDED
        NudgeTrigger.PARENT_SCHEDULED -> SdkWellbeingTrigger.SCHEDULED_TIME
        NudgeTrigger.CHILD_REQUESTED_IDEA -> SdkWellbeingTrigger.CHILD_REQUESTED_IDEA
        NudgeTrigger.SCREEN_LOCKED_BEST_EFFORT -> null
    }

    /**
     * Whether a parent-authored message whose `delivery.triggers` is [sdkTriggers] should be
     * considered eligible when Android is about to dispatch [androidTrigger]. Accounts for the
     * `BREAK_ACTIVE` -> `BREAK_STARTED` lossy mapping in both directions: a message that lists
     * either `BREAK_STARTED` or `BREAK_ACTIVE` is eligible on Android's `BREAK_STARTED` dispatch.
     */
    fun coversAndroidTrigger(sdkTriggers: Set<SdkWellbeingTrigger>, androidTrigger: NudgeTrigger): Boolean {
        if (androidTrigger == NudgeTrigger.SCREEN_LOCKED_BEST_EFFORT) return false
        return sdkTriggers.any { toAndroid(it) == androidTrigger }
    }
}
