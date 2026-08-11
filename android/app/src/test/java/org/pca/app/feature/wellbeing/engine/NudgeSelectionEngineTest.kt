package org.pca.app.feature.wellbeing.engine

import kotlin.time.Duration.Companion.minutes
import kotlin.time.Duration.Companion.seconds
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.pca.app.feature.wellbeing.catalogue.WellbeingContentCatalogue
import org.pca.app.feature.wellbeing.model.DurationBucket
import org.pca.app.feature.wellbeing.model.NudgeDeliveryStatus
import org.pca.app.feature.wellbeing.model.NudgeFeedbackType
import org.pca.app.feature.wellbeing.model.NudgeRateState
import org.pca.app.feature.wellbeing.model.NudgeTrigger
import org.pca.app.feature.wellbeing.model.NudgeTriggerContext
import org.pca.app.feature.wellbeing.model.WellbeingCategory
import org.pca.app.feature.wellbeing.model.WellbeingNudgeDelivery
import org.pca.app.feature.wellbeing.model.WellbeingNudgePolicy

class NudgeSelectionEngineTest {

    private val catalogue = WellbeingContentCatalogue.entries

    private fun baseContext(
        trigger: NudgeTrigger = NudgeTrigger.PERIODIC_HIGH_ENGAGEMENT_USE,
        nowNanos: Long = 1_000_000_000_000L,
        locked: Boolean = false,
        minuteOfDay: Int = 720,
    ) = NudgeTriggerContext(
        trigger = trigger,
        nowMonotonicNanos = nowNanos,
        eligibleAppToken = "app_token_1",
        isScreenLocked = locked,
        isEmergencyActive = false,
        isCallActive = false,
        isNavigationOrSafetyContextActive = false,
        isSchoolModeActive = false,
        isCriticalWarningActive = false,
        isDegradedOrErrorFlow = false,
        isBreakShieldActive = false,
        minuteOfDayForQuietHoursOnly = minuteOfDay,
        notificationsCapable = true,
        lockScreenNotificationsCapable = true,
    )

    @Test
    fun `feature disabled suppresses everything`() {
        val policy = WellbeingNudgePolicy(enabled = false)
        val (selection, _) = NudgeSelectionEngine.evaluate(policy, baseContext(), NudgeRateState(), catalogue)
        assertEquals(NudgeDeliveryStatus.SUPPRESSED_POLICY_DISABLED, selection.status)
    }

    @Test
    fun `eligible category yields a suggestion, disabled category yields none from it`() {
        val policy = WellbeingNudgePolicy(enabledCategories = setOf(WellbeingCategory.READING))
        val (selection, _) = NudgeSelectionEngine.evaluate(policy, baseContext(), NudgeRateState(), catalogue)
        assertEquals(NudgeDeliveryStatus.DELIVERED, selection.status)
        assertTrue(selection.suggestions.all { it.category == WellbeingCategory.READING })
    }

    @Test
    fun `faith content disabled excludes FAITH_POSITIVE even if category listed enabled`() {
        val policy = WellbeingNudgePolicy(
            enabledCategories = setOf(WellbeingCategory.FAITH_POSITIVE, WellbeingCategory.READING),
            faithContentEnabled = false,
        )
        repeat(20) {
            val (selection, _) = NudgeSelectionEngine.evaluate(
                policy,
                baseContext(nowNanos = 1_000_000_000_000L + it * 10_000_000_000L),
                NudgeRateState(),
                catalogue,
            )
            assertTrue(selection.suggestions.none { s -> s.category == WellbeingCategory.FAITH_POSITIVE })
        }
    }

    @Test
    fun `periodic trigger disabled via policy is suppressed`() {
        val policy = WellbeingNudgePolicy(periodicNudgesEnabled = false)
        val (selection, _) = NudgeSelectionEngine.evaluate(policy, baseContext(NudgeTrigger.PERIODIC_HIGH_ENGAGEMENT_USE), NudgeRateState(), catalogue)
        assertEquals(NudgeDeliveryStatus.SUPPRESSED_POLICY_DISABLED, selection.status)
    }

    @Test
    fun `minimum interval rate-limits a second nudge too soon`() {
        val policy = WellbeingNudgePolicy(minimumInterval = 20.minutes)
        val (first, rateAfterFirst) = NudgeSelectionEngine.evaluate(policy, baseContext(nowNanos = 0), NudgeRateState(), catalogue)
        assertEquals(NudgeDeliveryStatus.DELIVERED, first.status)

        val (second, _) = NudgeSelectionEngine.evaluate(
            policy,
            baseContext(nowNanos = 5.minutes.inWholeNanoseconds),
            rateAfterFirst,
            catalogue,
        )
        assertEquals(NudgeDeliveryStatus.SUPPRESSED_RATE_LIMIT, second.status)
    }

    @Test
    fun `daily cap suppresses further nudges once reached`() {
        val policy = WellbeingNudgePolicy(minimumInterval = 1.seconds, maximumDailyNudges = 2)
        var rateState = NudgeRateState()
        var now = 0L
        repeat(2) {
            val (selection, updated) = NudgeSelectionEngine.evaluate(policy, baseContext(nowNanos = now), rateState, catalogue)
            assertEquals(NudgeDeliveryStatus.DELIVERED, selection.status)
            rateState = updated
            now += 2.seconds.inWholeNanoseconds
        }
        val (third, _) = NudgeSelectionEngine.evaluate(policy, baseContext(nowNanos = now), rateState, catalogue)
        assertEquals(NudgeDeliveryStatus.SUPPRESSED_RATE_LIMIT, third.status)
    }

    @Test
    fun `same suggestion repeat cooldown prevents immediate reselection`() {
        val onlyOneReading = WellbeingContentCatalogue.byCategory(WellbeingCategory.READING)
            .filter { it.duration == DurationBucket.SHORT_2_5_MIN }
        val policy = WellbeingNudgePolicy(
            enabledCategories = setOf(WellbeingCategory.READING),
            durationPreferences = setOf(DurationBucket.SHORT_2_5_MIN),
            minimumInterval = 1.seconds,
            sameSuggestionRepeatCooldown = (24 * 60).minutes,
        )
        var rateState = NudgeRateState()
        val delivered = mutableListOf<String>()
        var now = 0L
        repeat(onlyOneReading.size) {
            val (selection, updated) = NudgeSelectionEngine.evaluate(policy, baseContext(nowNanos = now), rateState, catalogue)
            if (selection.status == NudgeDeliveryStatus.DELIVERED) delivered += selection.suggestions.map { it.suggestionId }
            rateState = updated
            now += 2.seconds.inWholeNanoseconds
        }
        // Every delivered suggestion within the cooldown window must be distinct (no immediate repeats).
        assertEquals(delivered.size, delivered.distinct().size)
    }

    @Test
    fun `NOT_FOR_ME suppresses that suggestion for a meaningful cooldown`() {
        val policy = WellbeingNudgePolicy(minimumInterval = 1.seconds)
        val (first, rateAfterFirst) = NudgeSelectionEngine.evaluate(policy, baseContext(nowNanos = 0), NudgeRateState(), catalogue)
        val rejectedId = first.suggestions.first().suggestionId
        val afterFeedback = NudgeSelectionEngine.applyFeedback(rateAfterFirst, rejectedId, NudgeFeedbackType.NOT_FOR_ME, 0L, policy)

        repeat(10) {
            val (selection, _) = NudgeSelectionEngine.evaluate(
                policy,
                baseContext(nowNanos = (it + 1) * 2.seconds.inWholeNanoseconds),
                afterFeedback,
                catalogue,
            )
            assertTrue(selection.suggestions.none { it.suggestionId == rejectedId })
        }
    }

    @Test
    fun `quiet hours suppress a system-initiated trigger`() {
        val policy = WellbeingNudgePolicy(quietHoursStartMinuteOfDay = 21 * 60, quietHoursEndMinuteOfDay = 7 * 60)
        val (selection, _) = NudgeSelectionEngine.evaluate(policy, baseContext(minuteOfDay = 22 * 60), NudgeRateState(), catalogue)
        assertEquals(NudgeDeliveryStatus.SUPPRESSED_QUIET_HOURS, selection.status)
    }

    @Test
    fun `quiet hours do not block a child-requested idea`() {
        val policy = WellbeingNudgePolicy(quietHoursStartMinuteOfDay = 21 * 60, quietHoursEndMinuteOfDay = 7 * 60)
        val (selection, _) = NudgeSelectionEngine.evaluate(
            policy,
            baseContext(trigger = NudgeTrigger.CHILD_REQUESTED_IDEA, minuteOfDay = 22 * 60),
            NudgeRateState(),
            catalogue,
        )
        assertEquals(NudgeDeliveryStatus.DELIVERED, selection.status)
    }

    @Test
    fun `lock-screen delivery unavailable when capability missing`() {
        val policy = WellbeingNudgePolicy()
        val ctx = baseContext(trigger = NudgeTrigger.SCREEN_LOCKED_BEST_EFFORT, locked = true)
            .copy(lockScreenNotificationsCapable = false)
        val (selection, _) = NudgeSelectionEngine.evaluate(policy, ctx, NudgeRateState(), catalogue)
        assertEquals(NudgeDeliveryStatus.SUPPRESSED_CAPABILITY_UNAVAILABLE, selection.status)
    }

    @Test
    fun `notifications denied falls back to in-app card for standard triggers`() {
        val policy = WellbeingNudgePolicy()
        val ctx = baseContext(trigger = NudgeTrigger.IMMEDIATE_APP_RETURN).copy(notificationsCapable = false)
        val (selection, _) = NudgeSelectionEngine.evaluate(policy, ctx, NudgeRateState(), catalogue)
        assertEquals(WellbeingNudgeDelivery.IN_APP_CARD, selection.recommendedDelivery)
        assertEquals(NudgeDeliveryStatus.DELIVERED, selection.status)
    }

    @Test
    fun `emergency active suppresses regardless of trigger`() {
        val policy = WellbeingNudgePolicy()
        val ctx = baseContext().copy(isEmergencyActive = true)
        val (selection, _) = NudgeSelectionEngine.evaluate(policy, ctx, NudgeRateState(), catalogue)
        assertEquals(NudgeDeliveryStatus.SUPPRESSED_EMERGENCY, selection.status)
    }

    @Test
    fun `active call suppresses`() {
        val policy = WellbeingNudgePolicy()
        val ctx = baseContext().copy(isCallActive = true)
        val (selection, _) = NudgeSelectionEngine.evaluate(policy, ctx, NudgeRateState(), catalogue)
        assertEquals(NudgeDeliveryStatus.SUPPRESSED_CALL_ACTIVE, selection.status)
    }

    @Test
    fun `navigation safety context suppresses`() {
        val policy = WellbeingNudgePolicy()
        val ctx = baseContext().copy(isNavigationOrSafetyContextActive = true)
        val (selection, _) = NudgeSelectionEngine.evaluate(policy, ctx, NudgeRateState(), catalogue)
        assertEquals(NudgeDeliveryStatus.SUPPRESSED_NAVIGATION_SAFETY, selection.status)
    }

    @Test
    fun `degraded or error flow suppresses`() {
        val policy = WellbeingNudgePolicy()
        val ctx = baseContext().copy(isDegradedOrErrorFlow = true)
        val (selection, _) = NudgeSelectionEngine.evaluate(policy, ctx, NudgeRateState(), catalogue)
        assertEquals(NudgeDeliveryStatus.SUPPRESSED_DEGRADED_STATE, selection.status)
    }

    @Test
    fun `duration preference filters out non-preferred buckets`() {
        val policy = WellbeingNudgePolicy(durationPreferences = setOf(DurationBucket.LONG_15_30_MIN))
        val (selection, _) = NudgeSelectionEngine.evaluate(policy, baseContext(), NudgeRateState(), catalogue)
        assertTrue(selection.suggestions.all { it.duration == DurationBucket.LONG_15_30_MIN })
    }

    @Test
    fun `choose-an-alternative card returns three diverse suggestions`() {
        val policy = WellbeingNudgePolicy()
        val (selection, _) = NudgeSelectionEngine.chooseAlternativeCard(policy, baseContext(), NudgeRateState(), catalogue)
        assertEquals(NudgeDeliveryStatus.DELIVERED, selection.status)
        assertEquals(3, selection.suggestions.size)
        assertEquals(selection.suggestions.map { it.suggestionId }.distinct().size, selection.suggestions.size)
    }

    @Test
    fun `evaluate is deterministic (replay-safe) for identical inputs`() {
        val policy = WellbeingNudgePolicy()
        val ctx = baseContext()
        val (a, _) = NudgeSelectionEngine.evaluate(policy, ctx, NudgeRateState(), catalogue)
        val (b, _) = NudgeSelectionEngine.evaluate(policy, ctx, NudgeRateState(), catalogue)
        assertEquals(a.suggestions.map { it.suggestionId }, b.suggestions.map { it.suggestionId })
    }

    @Test
    fun `no eligible suggestion when the pool is empty`() {
        val policy = WellbeingNudgePolicy(enabledCategories = emptySet())
        val (selection, _) = NudgeSelectionEngine.evaluate(policy, baseContext(), NudgeRateState(), catalogue)
        assertEquals(NudgeDeliveryStatus.NO_ELIGIBLE_SUGGESTION, selection.status)
    }

    @Test
    fun `clock rollback in lastNudgeMonotonicNanos never bypasses the minimum interval`() {
        val policy = WellbeingNudgePolicy(minimumInterval = 20.minutes)
        // Simulate state whose lastNudge is "in the future" relative to now (e.g. stale
        // cross-generation state that has not yet been through WellbeingRebootGuard).
        val rateState = NudgeRateState(lastNudgeMonotonicNanos = 10_000_000_000L)
        val (selection, _) = NudgeSelectionEngine.evaluate(policy, baseContext(nowNanos = 0L), rateState, catalogue)
        assertEquals(NudgeDeliveryStatus.SUPPRESSED_RATE_LIMIT, selection.status)
    }
}
