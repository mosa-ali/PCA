package org.pca.app.feature.wellbeing.model

/**
 * The 13 curated content categories (doc 35, PCA-WELL-006). `FAITH_POSITIVE` is optional and
 * never a condition for anything else (PCA-WELL-004) -- it is toggled exactly like any other
 * category via [WellbeingNudgePolicy.enabledCategories].
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
