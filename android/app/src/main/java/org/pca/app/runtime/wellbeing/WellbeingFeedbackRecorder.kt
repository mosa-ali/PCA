package org.pca.app.runtime.wellbeing

import org.pca.app.feature.wellbeing.engine.NudgeSelectionEngine
import org.pca.app.feature.wellbeing.model.NudgeFeedback
import org.pca.app.feature.wellbeing.model.NudgeFeedbackType
import org.pca.app.feature.wellbeing.model.NudgeRateState
import org.pca.app.feature.wellbeing.persistence.WellbeingPolicyStore
import org.pca.app.feature.wellbeing.persistence.WellbeingRateStateStore
import org.pca.app.feature.wellbeing.policy.WellbeingFeedbackLogStore
import org.pca.app.foundation.MonotonicTimeSource

/**
 * PCA-WELL-012 closure: the REAL production caller of [WellbeingFeedbackLogStore.append] and
 * [NudgeSelectionEngine.applyFeedback], both of which were real, unit-tested, but called from
 * NOWHERE in `src/main` until [org.pca.app.feature.wellbeing.ui.WellbeingCardActivity] existed
 * (mirrors [WellbeingRuntimeCoordinator]'s own "REAL production caller of a previously-unwired
 * engine method" framing, for the feedback half of this feature rather than the dispatch half).
 *
 * A single child [record] call does both things a "the child gave feedback on a suggestion" event
 * actually requires: appends the durable, privacy-minimized log entry
 * [WellbeingFeedbackLogStore] already offers (so `WellbeingAggregateSummaryBuilder` has something
 * real to summarize), AND folds the same feedback into the durable [NudgeRateState] via
 * [NudgeSelectionEngine.applyFeedback] so a `NOT_FOR_ME` genuinely suppresses that suggestion for
 * its cooldown window (PCA-WELL-005/017) rather than only ever being logged.
 */
class WellbeingFeedbackRecorder(
    private val feedbackLogStore: WellbeingFeedbackLogStore,
    private val policyStore: WellbeingPolicyStore,
    private val rateStateStore: WellbeingRateStateStore,
    private val monotonicTimeSource: MonotonicTimeSource,
) {
    fun record(suggestionId: String, feedback: NudgeFeedbackType) {
        val now = monotonicTimeSource.elapsedRealtimeNanos()
        feedbackLogStore.append(NudgeFeedback(suggestionId, feedback, now))

        val policy = policyStore.load()
        val rateState = rateStateStore.load() ?: NudgeRateState()
        rateStateStore.save(NudgeSelectionEngine.applyFeedback(rateState, suggestionId, feedback, now, policy))
    }
}
