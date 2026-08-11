package org.pca.app.feature.wellbeing.model

/**
 * All durable anti-spam / game-return state (PCA-WELL-008, PCA-WELL-011). MONOTONIC time only --
 * never wall-clock -- so a clock change can neither bypass nor spuriously trigger a nudge. See
 * doc 35 "Game-return durable state".
 *
 * [dayWindowAnchorMonotonicNanos] is the monotonic instant [dailyNudgeCount] started counting
 * from; it is NOT a calendar day boundary (there is no reliable monotonic wall-clock mapping
 * across reboots) -- a fixed-length rolling window anchored at last-reset, reset conservatively
 * (never optimistically) whenever continuity cannot be proven (e.g. a boot-generation change).
 */
data class NudgeRateState(
    val lastEligibleAppToken: String? = null,
    val lastEligibleExitMonotonicNanos: Long? = null,
    val lastScreenLockMonotonicNanos: Long? = null,
    val lastUnlockMonotonicNanos: Long? = null,
    val lastNudgeMonotonicNanos: Long? = null,
    val dayWindowAnchorMonotonicNanos: Long? = null,
    val dailyNudgeCount: Int = 0,
    val recentSuggestionIds: List<String> = emptyList(),
    /** suggestionId -> monotonic instant it was last delivered, for sameSuggestionRepeatCooldown. */
    val lastDeliveredAtBySuggestionId: Map<String, Long> = emptyMap(),
    /** suggestionId -> monotonic instant NOT_FOR_ME was recorded, for suppression cooldown. */
    val notForMeUntilBySuggestionId: Map<String, Long> = emptyMap(),
    /** Rapid-re-entry counter feeding the intentional-use reflection prompt. */
    val rapidReentryCount: Int = 0,
    val lastReflectionMonotonicNanos: Long? = null,
    val lastBootGenerationToken: String? = null,
) {
    companion object {
        const val MAX_RECENT_SUGGESTIONS = 20
    }
}
