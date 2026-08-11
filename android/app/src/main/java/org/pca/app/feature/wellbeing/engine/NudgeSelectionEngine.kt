package org.pca.app.feature.wellbeing.engine

import org.pca.app.feature.wellbeing.model.NudgeDeliveryStatus
import org.pca.app.feature.wellbeing.model.NudgeFeedbackType
import org.pca.app.feature.wellbeing.model.NudgeRateState
import org.pca.app.feature.wellbeing.model.NudgeSelection
import org.pca.app.feature.wellbeing.model.NudgeTrigger
import org.pca.app.feature.wellbeing.model.NudgeTriggerContext
import org.pca.app.feature.wellbeing.model.WellbeingCategory
import org.pca.app.feature.wellbeing.model.WellbeingNudgeDelivery
import org.pca.app.feature.wellbeing.model.WellbeingNudgePolicy
import org.pca.app.feature.wellbeing.model.WellbeingSuggestion

/**
 * Fully deterministic, local, offline selection engine (PCA-WELL-015). No cloud calls, no
 * personality/religiosity/mental-health/emotion inference, and never optimized for keeping the
 * child in PCA itself -- it is explicitly allowed (and expected) to recommend `CONTINUE`.
 *
 * Pure function of (policy, context, rateState, available suggestions) -> result; identical
 * inputs always produce the same [NudgeDeliveryStatus] and delivery-channel recommendation
 * (suggestion *ordering* among tied candidates uses [NudgeTriggerContext.nowMonotonicNanos] as a
 * deterministic seed, never real randomness, so a replay is reproducible for tests/audits).
 */
object NudgeSelectionEngine {

    private const val REFLECTION_RAPID_REENTRY_THRESHOLD = 3
    private const val CHOOSE_ALTERNATIVE_COUNT = 3

    /** Triggers the child initiates themselves (pull) -- exempt from rate limiting and quiet
     * hours, since nothing is being pushed at them; they asked. */
    private val CHILD_INITIATED = setOf(NudgeTrigger.CHILD_REQUESTED_IDEA)

    /** Triggers that are about a specific foreground/just-exited app, and therefore the only ones
     * [WellbeingNudgePolicy.eligibleApps] (WELL-1) is meaningful for. A non-empty `eligibleApps`
     * never restricts triggers that aren't about a particular app (e.g. a break card or the
     * child's own [NudgeTrigger.CHILD_REQUESTED_IDEA] pull). */
    private val APP_SIGNAL_DRIVEN_TRIGGERS = setOf(
        NudgeTrigger.IMMEDIATE_APP_RETURN,
        NudgeTrigger.PERIODIC_HIGH_ENGAGEMENT_USE,
        NudgeTrigger.LONG_SESSION_ENDED,
    )

    /** Delivery surfaces that are clearly foreground and interactive -- the only ones a suggestion
     * marked [WellbeingSuggestion.requiresAdultSupervision] may ever be offered on (WELL-2). Every
     * other surface (lock screen, standard/background notification, next-unlock card) may be seen
     * with no adult present, so a hazard-adjacent suggestion must never appear there. */
    private val ADULT_SUPERVISION_SAFE_DELIVERIES = setOf(WellbeingNudgeDelivery.IN_APP_CARD)

    fun evaluate(
        policy: WellbeingNudgePolicy,
        context: NudgeTriggerContext,
        rateState: NudgeRateState,
        catalogueEntries: List<WellbeingSuggestion>,
        customApprovedEntries: List<WellbeingSuggestion> = emptyList(),
        requestedCount: Int = defaultRequestedCount(context),
    ): Pair<NudgeSelection, NudgeRateState> {
        suppressionStatus(policy, context)?.let {
            return NudgeSelection(it, emptyList(), null) to rateState
        }
        appEligibilityStatus(policy, context)?.let {
            return NudgeSelection(it, emptyList(), null) to rateState
        }

        val isChildInitiated = context.trigger in CHILD_INITIATED
        val normalizedRateState = normalizeDayWindow(rateState, context.nowMonotonicNanos)

        if (!isChildInitiated) {
            if (policy.isQuietAt(context.minuteOfDayForQuietHoursOnly)) {
                return NudgeSelection(NudgeDeliveryStatus.SUPPRESSED_QUIET_HOURS, emptyList(), null) to normalizedRateState
            }
            rateLimitStatus(policy, context, normalizedRateState)?.let {
                return NudgeSelection(it, emptyList(), null) to normalizedRateState
            }
        }

        val delivery = recommendedDelivery(policy, context) ?: return NudgeSelection(
            NudgeDeliveryStatus.SUPPRESSED_CAPABILITY_UNAVAILABLE,
            emptyList(),
            null,
        ) to normalizedRateState

        val pool = eligiblePool(policy, context, delivery, catalogueEntries + customApprovedEntries, normalizedRateState)
        if (pool.isEmpty()) {
            return NudgeSelection(NudgeDeliveryStatus.NO_ELIGIBLE_SUGGESTION, emptyList(), delivery) to normalizedRateState
        }

        val picked = pickDiverse(pool, normalizedRateState, requestedCount, context.nowMonotonicNanos)

        val updatedRateState = if (isChildInitiated) {
            normalizedRateState.recordDelivery(picked, context.nowMonotonicNanos, incrementDaily = false)
        } else {
            normalizedRateState.recordDelivery(picked, context.nowMonotonicNanos, incrementDaily = true)
        }

        return NudgeSelection(NudgeDeliveryStatus.DELIVERED, picked, delivery) to updatedRateState
    }

    /** Applies self-reported feedback to durable rate state (PCA-WELL-005/017). NOT_FOR_ME
     * suppresses that suggestion for [WellbeingNudgePolicy.sameSuggestionRepeatCooldown] * 3 (a
     * meaningfully longer cooldown than an ordinary repeat, without being permanent). */
    fun applyFeedback(
        rateState: NudgeRateState,
        suggestionId: String,
        feedback: NudgeFeedbackType,
        nowNanos: Long,
        policy: WellbeingNudgePolicy,
    ): NudgeRateState = when (feedback) {
        NudgeFeedbackType.NOT_FOR_ME -> {
            val cooldownNanos = policy.sameSuggestionRepeatCooldown.inWholeNanoseconds * 3
            rateState.copy(
                notForMeUntilBySuggestionId = rateState.notForMeUntilBySuggestionId + (suggestionId to nowNanos + cooldownNanos),
            )
        }
        else -> rateState
    }

    // --- Game-return / rapid re-entry -----------------------------------------------------

    /** Records an app exit; call from the IMMEDIATE_APP_RETURN trigger source when the eligible
     * app leaves the foreground. */
    fun onEligibleAppExit(rateState: NudgeRateState, appToken: String, nowNanos: Long): NudgeRateState =
        rateState.copy(lastEligibleAppToken = appToken, lastEligibleExitMonotonicNanos = nowNanos)

    fun onScreenLock(rateState: NudgeRateState, nowNanos: Long): NudgeRateState =
        rateState.copy(lastScreenLockMonotonicNanos = nowNanos)

    fun onScreenUnlock(rateState: NudgeRateState, nowNanos: Long): NudgeRateState =
        rateState.copy(lastUnlockMonotonicNanos = nowNanos)

    /** True iff the child re-entered the same eligible app within [WellbeingNudgePolicy.gameReturnWindow]
     * of leaving it (PCA-WELL-010) -- MONOTONIC only. */
    fun isWithinGameReturnWindow(
        rateState: NudgeRateState,
        appToken: String,
        nowNanos: Long,
        policy: WellbeingNudgePolicy,
    ): Boolean {
        val exit = rateState.lastEligibleExitMonotonicNanos ?: return false
        if (rateState.lastEligibleAppToken != appToken) return false
        val delta = nowNanos - exit
        return delta in 0..policy.gameReturnWindow.inWholeNanoseconds
    }

    /** Updates the rapid-re-entry counter and reports whether the intentional-use reflection
     * prompt should now be shown (never shown more than once per its own cooldown window, reusing
     * `sameSuggestionRepeatCooldown` magnitude as a reasonable minimum spacing). */
    fun onGameReturnObserved(
        rateState: NudgeRateState,
        nowNanos: Long,
        policy: WellbeingNudgePolicy,
    ): Pair<NudgeRateState, Boolean> {
        val incremented = rateState.copy(rapidReentryCount = rateState.rapidReentryCount + 1)
        if (incremented.rapidReentryCount < REFLECTION_RAPID_REENTRY_THRESHOLD) {
            return incremented to false
        }
        val lastReflection = incremented.lastReflectionMonotonicNanos
        val cooldownElapsed = lastReflection == null ||
            (nowNanos - lastReflection) >= policy.sameSuggestionRepeatCooldown.inWholeNanoseconds
        if (!cooldownElapsed) {
            return incremented to false
        }
        return incremented.copy(rapidReentryCount = 0, lastReflectionMonotonicNanos = nowNanos) to true
    }

    /** "Choose an alternative" card: always 3 diversity-aware suggestions (PCA-WELL brief), used
     * for the TRY_AN_ALTERNATIVE outcome of a game-return nudge and for a child explicitly asking
     * to see choices rather than a single idea. */
    fun chooseAlternativeCard(
        policy: WellbeingNudgePolicy,
        context: NudgeTriggerContext,
        rateState: NudgeRateState,
        catalogueEntries: List<WellbeingSuggestion>,
        customApprovedEntries: List<WellbeingSuggestion> = emptyList(),
    ): Pair<NudgeSelection, NudgeRateState> = evaluate(
        policy,
        context.copy(trigger = NudgeTrigger.CHILD_REQUESTED_IDEA),
        rateState,
        catalogueEntries,
        customApprovedEntries,
        requestedCount = CHOOSE_ALTERNATIVE_COUNT,
    )

    private fun defaultRequestedCount(context: NudgeTriggerContext): Int = 1

    // --- internals --------------------------------------------------------------------------

    private fun suppressionStatus(policy: WellbeingNudgePolicy, context: NudgeTriggerContext): NudgeDeliveryStatus? = when {
        !policy.enabled -> NudgeDeliveryStatus.SUPPRESSED_POLICY_DISABLED
        context.isEmergencyActive -> NudgeDeliveryStatus.SUPPRESSED_EMERGENCY
        context.isCallActive -> NudgeDeliveryStatus.SUPPRESSED_CALL_ACTIVE
        // PCA-3 bedtime/schedule suppression (WELL-3) ranks second, immediately below emergency/
        // call safety, and strictly above wellbeing's own optional quiet-hours fields (checked
        // later, only for non-child-initiated triggers): bedtime is never overridden by a
        // wellbeing-local override window, and unlike wellbeing quiet hours it also applies to
        // child-initiated triggers -- it is PCA-3's authority, not a wellbeing preference.
        context.isPcaBedtimeActive || context.isScheduledQuietContext -> NudgeDeliveryStatus.SUPPRESSED_PCA_BEDTIME
        context.isNavigationOrSafetyContextActive -> NudgeDeliveryStatus.SUPPRESSED_NAVIGATION_SAFETY
        context.isSchoolModeActive -> NudgeDeliveryStatus.SUPPRESSED_POLICY_DISABLED
        context.isCriticalWarningActive -> NudgeDeliveryStatus.SUPPRESSED_DEGRADED_STATE
        context.isDegradedOrErrorFlow -> NudgeDeliveryStatus.SUPPRESSED_DEGRADED_STATE
        context.trigger == NudgeTrigger.PERIODIC_HIGH_ENGAGEMENT_USE && !policy.periodicNudgesEnabled -> NudgeDeliveryStatus.SUPPRESSED_POLICY_DISABLED
        context.trigger == NudgeTrigger.IMMEDIATE_APP_RETURN && !policy.gameReturnNudgeEnabled -> NudgeDeliveryStatus.SUPPRESSED_POLICY_DISABLED
        context.trigger == NudgeTrigger.BREAK_STARTED && !policy.breakSuggestionsEnabled -> NudgeDeliveryStatus.SUPPRESSED_POLICY_DISABLED
        context.trigger == NudgeTrigger.BREAK_COMPLETED && !policy.breakSuggestionsEnabled -> NudgeDeliveryStatus.SUPPRESSED_POLICY_DISABLED
        else -> null
    }

    /** WELL-1: an empty [WellbeingNudgePolicy.eligibleApps] is the documented "no restriction"
     * default -- every app observed via `EligibleAppSignalSource` remains eligible, exactly as
     * before this field was consumed. A non-empty set narrows eligibility, for app-driven triggers
     * only, to those opaque tokens -- compared for exact equality only, never by readable app
     * name (PCA-WELL-027: app names must never appear here or anywhere else in this module). */
    private fun appEligibilityStatus(policy: WellbeingNudgePolicy, context: NudgeTriggerContext): NudgeDeliveryStatus? {
        if (policy.eligibleApps.isEmpty()) return null
        if (context.trigger !in APP_SIGNAL_DRIVEN_TRIGGERS) return null
        val token = context.eligibleAppToken
        return if (token == null || token !in policy.eligibleApps) NudgeDeliveryStatus.SUPPRESSED_APP_NOT_ELIGIBLE else null
    }

    private fun rateLimitStatus(
        policy: WellbeingNudgePolicy,
        context: NudgeTriggerContext,
        rateState: NudgeRateState,
    ): NudgeDeliveryStatus? {
        rateState.lastNudgeMonotonicNanos?.let { last ->
            // A negative delta (nowNanos < last) should never be trusted as "plenty of time has
            // passed" -- an ordinary monotonic clock cannot go backwards within one boot
            // generation, so a negative reading here means state that hasn't gone through
            // WellbeingRebootGuard.reconcile() yet (or a defensive corruption case). Either way,
            // treat it the same as "well within the minimum interval", never as bypassing it --
            // mirrors PCA-3's clamped-delta anti-rollback rule (doc 12).
            val sinceLast = context.nowMonotonicNanos - last
            if (sinceLast < policy.minimumInterval.inWholeNanoseconds) {
                return NudgeDeliveryStatus.SUPPRESSED_RATE_LIMIT
            }
        }
        if (rateState.dailyNudgeCount >= policy.maximumDailyNudges) {
            return NudgeDeliveryStatus.SUPPRESSED_RATE_LIMIT
        }
        return null
    }

    private fun recommendedDelivery(policy: WellbeingNudgePolicy, context: NudgeTriggerContext): WellbeingNudgeDelivery? =
        when (context.trigger) {
            NudgeTrigger.BREAK_STARTED, NudgeTrigger.BREAK_COMPLETED ->
                if (context.isBreakShieldActive) WellbeingNudgeDelivery.BREAK_SHIELD_CARD else WellbeingNudgeDelivery.IN_APP_CARD

            NudgeTrigger.SCREEN_LOCKED_BEST_EFFORT ->
                if (policy.lockScreenSuggestionsEnabled && context.lockScreenNotificationsCapable) {
                    WellbeingNudgeDelivery.LOCK_SCREEN_NOTIFICATION_BEST_EFFORT
                } else {
                    null
                }

            NudgeTrigger.AFTER_SCREEN_UNLOCK -> WellbeingNudgeDelivery.NEXT_UNLOCK_CARD

            NudgeTrigger.IMMEDIATE_APP_RETURN, NudgeTrigger.PERIODIC_HIGH_ENGAGEMENT_USE,
            NudgeTrigger.LONG_SESSION_ENDED, NudgeTrigger.PARENT_SCHEDULED ->
                if (context.notificationsCapable) WellbeingNudgeDelivery.STANDARD_NOTIFICATION else WellbeingNudgeDelivery.IN_APP_CARD

            NudgeTrigger.CHILD_REQUESTED_IDEA -> WellbeingNudgeDelivery.IN_APP_CARD
        }

    private fun eligiblePool(
        policy: WellbeingNudgePolicy,
        context: NudgeTriggerContext,
        delivery: WellbeingNudgeDelivery,
        candidates: List<WellbeingSuggestion>,
        rateState: NudgeRateState,
    ): List<WellbeingSuggestion> = candidates.filter { suggestion ->
        suggestion.enabledByDefault &&
            suggestion.category in policy.enabledCategories &&
            (suggestion.category != WellbeingCategory.FAITH_POSITIVE || policy.faithContentEnabled) &&
            suggestion.duration in policy.durationPreferences &&
            (delivery != WellbeingNudgeDelivery.LOCK_SCREEN_NOTIFICATION_BEST_EFFORT || suggestion.lockScreenSafe) &&
            // WELL-2: a suggestion requiring adult supervision may only ever be offered on a
            // clearly foreground, interactive surface -- never on the lock screen, an ordinary/
            // background notification, or the next-unlock card, where no adult context exists.
            (!suggestion.requiresAdultSupervision || delivery in ADULT_SUPERVISION_SAFE_DELIVERIES) &&
            notSuppressed(suggestion.suggestionId, rateState, context.nowMonotonicNanos) &&
            notOnRepeatCooldown(suggestion.suggestionId, rateState, context.nowMonotonicNanos, policy)
    }

    private fun notSuppressed(suggestionId: String, rateState: NudgeRateState, nowNanos: Long): Boolean {
        val until = rateState.notForMeUntilBySuggestionId[suggestionId] ?: return true
        return nowNanos >= until
    }

    private fun notOnRepeatCooldown(
        suggestionId: String,
        rateState: NudgeRateState,
        nowNanos: Long,
        policy: WellbeingNudgePolicy,
    ): Boolean {
        val lastDelivered = rateState.lastDeliveredAtBySuggestionId[suggestionId] ?: return true
        return (nowNanos - lastDelivered) >= policy.sameSuggestionRepeatCooldown.inWholeNanoseconds
    }

    /** Variety/diversity engine (PCA-WELL-016): prefers suggestions whose category was not among
     * the most recent picks, then a deterministic rotation seeded by [seedNanos] so repeated
     * evaluation with identical state is reproducible rather than relying on real randomness. */
    private fun pickDiverse(
        pool: List<WellbeingSuggestion>,
        rateState: NudgeRateState,
        count: Int,
        seedNanos: Long,
    ): List<WellbeingSuggestion> {
        val recentCategories = rateState.recentSuggestionIds
            .mapNotNull { id -> pool.firstOrNull { it.suggestionId == id }?.category }
            .toSet()

        val preferred = pool.filter { it.category !in recentCategories }
        val ordered = (preferred.ifEmpty { pool })
            .sortedBy { it.suggestionId }

        val result = mutableListOf<WellbeingSuggestion>()
        val usedCategories = mutableSetOf<WellbeingCategory>()
        var cursor = (seedNanos.mod(ordered.size.coerceAtLeast(1).toLong())).toInt()

        var attempts = 0
        while (result.size < count && attempts < ordered.size * 2 && ordered.isNotEmpty()) {
            val candidate = ordered[cursor % ordered.size]
            if (candidate.category !in usedCategories || result.size >= ordered.distinctBy { it.category }.size) {
                result += candidate
                usedCategories += candidate.category
            }
            cursor++
            attempts++
        }
        // Fall back to filling from the pool if strict category diversity couldn't reach `count`.
        if (result.size < count) {
            for (candidate in ordered) {
                if (result.size >= count) break
                if (candidate !in result) result += candidate
            }
        }
        return result.take(count)
    }

    private fun normalizeDayWindow(rateState: NudgeRateState, nowNanos: Long): NudgeRateState {
        val dayNanos = 24L * 60 * 60 * 1_000_000_000L
        val anchor = rateState.dayWindowAnchorMonotonicNanos
        val elapsed = anchor?.let { nowNanos - it }
        return if (anchor == null || elapsed == null || elapsed < 0 || elapsed >= dayNanos) {
            rateState.copy(dayWindowAnchorMonotonicNanos = nowNanos, dailyNudgeCount = 0)
        } else {
            rateState
        }
    }

    private fun NudgeRateState.recordDelivery(
        picked: List<WellbeingSuggestion>,
        nowNanos: Long,
        incrementDaily: Boolean,
    ): NudgeRateState {
        val newRecent = (picked.map { it.suggestionId } + recentSuggestionIds)
            .distinct()
            .take(NudgeRateState.MAX_RECENT_SUGGESTIONS)
        val newLastDelivered = lastDeliveredAtBySuggestionId + picked.associate { it.suggestionId to nowNanos }
        return copy(
            lastNudgeMonotonicNanos = if (incrementDaily) nowNanos else lastNudgeMonotonicNanos,
            dailyNudgeCount = if (incrementDaily) dailyNudgeCount + 1 else dailyNudgeCount,
            recentSuggestionIds = newRecent,
            lastDeliveredAtBySuggestionId = newLastDelivered,
        )
    }
}
