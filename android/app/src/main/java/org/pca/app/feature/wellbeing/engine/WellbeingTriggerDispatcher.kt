package org.pca.app.feature.wellbeing.engine

import org.pca.app.feature.wellbeing.model.GameReturnResponse
import org.pca.app.feature.wellbeing.model.NudgeRateState
import org.pca.app.feature.wellbeing.model.NudgeSelection
import org.pca.app.feature.wellbeing.model.NudgeTrigger
import org.pca.app.feature.wellbeing.model.NudgeTriggerContext
import org.pca.app.feature.wellbeing.model.WellbeingNudgePolicy
import org.pca.app.feature.wellbeing.model.WellbeingSuggestion
import org.pca.app.feature.wellbeing.ports.BreakStateSource
import org.pca.app.feature.wellbeing.ports.EligibleAppSignalSource
import org.pca.app.feature.wellbeing.ports.NotificationCapabilitySource
import org.pca.app.feature.wellbeing.ports.ScreenLockStateSource
import org.pca.app.feature.wellbeing.ports.NoOpWellbeingScheduleContextSource
import org.pca.app.feature.wellbeing.ports.SuppressionContextSource
import org.pca.app.feature.wellbeing.ports.WallClockCalendarSource
import org.pca.app.feature.wellbeing.ports.WellbeingScheduleContextSource
import org.pca.app.foundation.MonotonicTimeSource

/**
 * Platform-neutral orchestrator: wires the narrow ports (doc 35) into [NudgeSelectionEngine]
 * calls for each [NudgeTrigger], without itself depending on any Android API -- an Android
 * (or future iOS) delivery layer wraps this to actually post a notification/render a card. This
 * class never mutates PCA-3's `ScreenTimeState`; [BreakStateSource] is read-only here.
 *
 * Caller contract (anti-spam correctness, PCA-WELL-008): every [NudgeSelection]/[NudgeRateState]
 * pair returned here MUST be persisted (`WellbeingRateStateStore.save`) before the next call --
 * these methods are pure and never persist anything themselves. Calling `dispatch` repeatedly
 * with a stale, unpersisted [NudgeRateState] is exactly equivalent to replaying the same trigger
 * over and over and will bypass rate limiting, since each call only sees what it was handed.
 *
 * On [GameReturnResponse.TRY_AN_ALTERNATIVE], the caller is expected to follow up with
 * [NudgeSelectionEngine.chooseAlternativeCard] for the 3-suggestion "choose an alternative" card
 * -- that is a separate, explicit UI-driven call, not something this dispatcher chains
 * automatically, so the child's tap is what causes the extra content to appear rather than it
 * being bundled unconditionally into the original nudge.
 */
class WellbeingTriggerDispatcher(
    private val monotonicTimeSource: MonotonicTimeSource,
    private val eligibleAppSignalSource: EligibleAppSignalSource,
    private val screenLockStateSource: ScreenLockStateSource,
    private val notificationCapabilitySource: NotificationCapabilitySource,
    private val suppressionContextSource: SuppressionContextSource,
    private val breakStateSource: BreakStateSource,
    private val wallClockCalendarSource: WallClockCalendarSource,
    /** Defaults to the conservative no-op adapter (WELL-3): real wiring to PCA-3's live bedtime
     * state is a Coordinator integration task, same boundary as the other cross-feature ports
     * above (see `docs/architecture/COORDINATOR_INTEGRATION_QUEUE.md`). */
    private val scheduleContextSource: WellbeingScheduleContextSource = NoOpWellbeingScheduleContextSource(),
) {
    fun buildContext(trigger: NudgeTrigger): NudgeTriggerContext = NudgeTriggerContext(
        trigger = trigger,
        nowMonotonicNanos = monotonicTimeSource.elapsedRealtimeNanos(),
        eligibleAppToken = eligibleAppSignalSource.currentEligibleAppToken(),
        isScreenLocked = screenLockStateSource.isScreenLocked(),
        isEmergencyActive = suppressionContextSource.isEmergencyActive(),
        isCallActive = suppressionContextSource.isCallActive(),
        isNavigationOrSafetyContextActive = suppressionContextSource.isNavigationOrSafetyContextActive(),
        isSchoolModeActive = suppressionContextSource.isSchoolModeActive(),
        isCriticalWarningActive = suppressionContextSource.isCriticalWarningActive(),
        isDegradedOrErrorFlow = suppressionContextSource.isDegradedOrErrorFlow(),
        isBreakShieldActive = breakStateSource.isBreakShieldActive(),
        minuteOfDayForQuietHoursOnly = wallClockCalendarSource.minuteOfDay(),
        notificationsCapable = notificationCapabilitySource.notificationsEnabled(),
        lockScreenNotificationsCapable = notificationCapabilitySource.lockScreenNotificationsAvailable(),
        isPcaBedtimeActive = scheduleContextSource.isPcaBedtimeActive(),
        isScheduledQuietContext = scheduleContextSource.isScheduledQuietContext(),
    )

    fun dispatch(
        trigger: NudgeTrigger,
        policy: WellbeingNudgePolicy,
        rateState: NudgeRateState,
        catalogueEntries: List<WellbeingSuggestion>,
        customApprovedEntries: List<WellbeingSuggestion> = emptyList(),
    ): Pair<NudgeSelection, NudgeRateState> {
        val context = buildContext(trigger)
        return NudgeSelectionEngine.evaluate(policy, context, rateState, catalogueEntries, customApprovedEntries)
    }

    /** IMMEDIATE_APP_RETURN handling: detects a rapid re-entry into the same eligible app and, if
     * still within [WellbeingNudgePolicy.gameReturnWindow], evaluates a soft GAME_RETURN_NUDGE
     * (PCA-WELL-010) plus the rapid-re-entry reflection counter. [response] from a *previous*
     * game-return nudge (if any) is applied first so CONTINUE never re-triggers immediately. */
    fun handleAppForegrounded(
        appToken: String,
        policy: WellbeingNudgePolicy,
        rateState: NudgeRateState,
        catalogueEntries: List<WellbeingSuggestion>,
        customApprovedEntries: List<WellbeingSuggestion> = emptyList(),
    ): GameReturnOutcome {
        val now = monotonicTimeSource.elapsedRealtimeNanos()
        val withinWindow = NudgeSelectionEngine.isWithinGameReturnWindow(rateState, appToken, now, policy)
        if (!withinWindow) {
            return GameReturnOutcome(rateState, null, showReflectionPrompt = false)
        }
        val (afterReentry, showReflection) = NudgeSelectionEngine.onGameReturnObserved(rateState, now, policy)
        val context = buildContext(NudgeTrigger.IMMEDIATE_APP_RETURN).copy(nowMonotonicNanos = now)
        val (selection, updated) = NudgeSelectionEngine.evaluate(policy, context, afterReentry, catalogueEntries, customApprovedEntries)
        return GameReturnOutcome(updated, selection, showReflection)
    }

    /** Records the child's soft response to a delivered GAME_RETURN_NUDGE (PCA-WELL-010). None of
     * the three outcomes touch PCA-3's screen-time/break state. */
    fun applyGameReturnResponse(
        response: GameReturnResponse,
        rateState: NudgeRateState,
    ): NudgeRateState = when (response) {
        GameReturnResponse.CONTINUE -> rateState
        GameReturnResponse.TRY_AN_ALTERNATIVE -> rateState
        GameReturnResponse.REMIND_ME_LATER -> rateState
    }

    data class GameReturnOutcome(
        val rateState: NudgeRateState,
        val selection: NudgeSelection?,
        val showReflectionPrompt: Boolean,
    )
}
