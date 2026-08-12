package org.pca.app.feature.wellbeing.model

/**
 * The 13 curated content categories (doc 35, PCA-WELL-006), plus [PARENT_CUSTOM_OTHER] (added by
 * PCA-RUNTIME-WELL-1, doc 38). `FAITH_POSITIVE` is optional and never a condition for anything
 * else (PCA-WELL-004) -- it is toggled exactly like any other category via
 * [WellbeingNudgePolicy.enabledCategories].
 *
 * [PARENT_CUSTOM_OTHER] is the Android-runtime landing spot for the parent-SDK's generic `CUSTOM`
 * category (`parent-sdk/wellbeing-control/src/types.ts` `WellbeingCategory`), used only when a
 * parent-authored custom wellbeing message doesn't fit any of the 12 substantive categories above.
 * Like [CHILD_SELECTED_FAVORITES] it deliberately has NO pre-authored catalogue entries -- it only
 * ever appears on parent-authored custom content synced in via the parent-policy adapter (see
 * `feature/wellbeing/policy/CategoryMapping.kt` and doc 38). It is a *different* concept from
 * [CHILD_SELECTED_FAVORITES] (which is a dynamic, child-facing, engine-synthesized bucket) and the
 * two must never be conflated.
 */
enum class WellbeingCategory {
    SKILLS_AND_LEARNING,
    READING,
    FAITH_POSITIVE,
    GRATITUDE,
    GOOD_DEED,
    FAMILY_HELP,
    HOME_RESPONSIBILITY,
    CREATIVITY,
    MOVEMENT_RESET,
    REST_AND_RESET,
    OUTDOOR_OR_OFFSCREEN,
    PLANNING_AND_ORGANIZATION,
    CHILD_SELECTED_FAVORITES,
    PARENT_CUSTOM_OTHER,
}

/** Rough time a suggestion is expected to take -- never an enforced/timed duration. */
enum class DurationBucket {
    SHORT_2_5_MIN,
    MEDIUM_5_15_MIN,
    LONG_15_30_MIN,
}

/**
 * Every event that may originate a nudge (PCA-WELL-009). All of these consume signals already
 * produced by PCA-3 (screen time / break engine, doc 12) or PCA-4 (app usage visibility, doc 15)
 * via this module's narrow ports -- none of them require a new screen-time engine.
 */
enum class NudgeTrigger {
    PERIODIC_HIGH_ENGAGEMENT_USE,
    IMMEDIATE_APP_RETURN,
    AFTER_SCREEN_UNLOCK,
    SCREEN_LOCKED_BEST_EFFORT,
    BREAK_STARTED,
    BREAK_COMPLETED,
    LONG_SESSION_ENDED,
    CHILD_REQUESTED_IDEA,
    PARENT_SCHEDULED,
}

/** Delivery surfaces (PCA-WELL-012). Android only ever uses ordinary notifications; see doc 35. */
enum class WellbeingNudgeDelivery {
    IN_APP_CARD,
    BREAK_SHIELD_CARD,
    STANDARD_NOTIFICATION,
    LOCK_SCREEN_NOTIFICATION_BEST_EFFORT,
    NEXT_UNLOCK_CARD,
    PARENT_PANEL_PREVIEW,
}

/** Self-reported child feedback only (PCA-WELL-005) -- no sensor/camera/mic verification exists. */
enum class NudgeFeedbackType {
    HELPFUL,
    NOT_FOR_ME,
    REMIND_LATER,
    DONE_SELF_REPORTED,
}

/** The three soft outcomes of a GAME_RETURN_NUDGE (PCA-WELL-010). CONTINUE is never a failure. */
enum class GameReturnResponse {
    CONTINUE,
    TRY_AN_ALTERNATIVE,
    REMIND_ME_LATER,
}

/** Outcome of attempting to deliver a nudge through a given channel. */
enum class NudgeDeliveryStatus {
    DELIVERED,
    SUPPRESSED_QUIET_HOURS,
    SUPPRESSED_EMERGENCY,
    SUPPRESSED_CALL_ACTIVE,
    SUPPRESSED_RATE_LIMIT,
    SUPPRESSED_POLICY_DISABLED,
    SUPPRESSED_CAPABILITY_UNAVAILABLE,
    SUPPRESSED_NAVIGATION_SAFETY,
    SUPPRESSED_DEGRADED_STATE,
    NO_ELIGIBLE_SUGGESTION,
    /** PCA-3 bedtime/schedule is active (or a PCA-scheduled quiet context otherwise applies),
     * consulted via [org.pca.app.feature.wellbeing.ports.WellbeingScheduleContextSource] (WELL-3).
     * This always outranks wellbeing's own optional `quietHoursStartMinuteOfDay`/`EndMinuteOfDay`
     * fields -- PCA bedtime is never overridden by a wellbeing-local override window. */
    SUPPRESSED_PCA_BEDTIME,
    /** [WellbeingNudgePolicy.eligibleApps] is non-empty and the app driving this trigger is not in
     * that set (WELL-1). Never applies to triggers that are not tied to a specific foreground/
     * just-exited app (e.g. [NudgeTrigger.CHILD_REQUESTED_IDEA], [NudgeTrigger.BREAK_STARTED]). */
    SUPPRESSED_APP_NOT_ELIGIBLE,
}

/** Outcome of the intentional-use reflection prompt after repeated rapid re-entry. */
enum class ReflectionResponse {
    CONTINUE,
    TAKE_A_SHORT_BREAK,
    TRY_SOMETHING_USEFUL,
}

/** Outcome of the once-a-day mission card. */
enum class DailyMissionResponse {
    DONE,
    SKIP,
    NEW_IDEA,
}
