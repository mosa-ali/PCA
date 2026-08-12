package org.pca.app.runtime.wellbeing

import org.pca.app.feature.wellbeing.engine.WellbeingTriggerDispatcher
import org.pca.app.feature.wellbeing.model.NudgeDeliveryResult
import org.pca.app.feature.wellbeing.model.NudgeDeliveryStatus
import org.pca.app.feature.wellbeing.model.NudgeRateState
import org.pca.app.feature.wellbeing.model.NudgeTrigger
import org.pca.app.feature.wellbeing.model.WellbeingNudgeDelivery
import org.pca.app.feature.wellbeing.model.WellbeingSuggestion
import org.pca.app.feature.wellbeing.persistence.WellbeingPolicyStore
import org.pca.app.feature.wellbeing.persistence.WellbeingRateStateStore
import org.pca.app.foundation.MonotonicTimeSource

/**
 * Correction round Section 10/11: the REAL production caller of
 * [WellbeingTriggerDispatcher.dispatch] -- until this class existed, the dispatcher was
 * constructed but never invoked from anywhere in `src/main`. Bound to real, bounded runtime
 * events (screen unlock/lock, break start/complete, a child's explicit "give me an idea" action)
 * rather than a spamming timer (Section 10 explicitly forbids that).
 *
 * Owns the two durable stores this call path requires ([WellbeingPolicyStore],
 * [WellbeingRateStateStore]) and the anti-spam persist-before-next-call contract
 * [WellbeingTriggerDispatcher]'s own doc comment requires -- every call here loads, dispatches,
 * and immediately persists the updated [NudgeRateState] before returning.
 *
 * [deliver] is a plain function reference (production: `WellbeingNotificationDelivery::deliver`)
 * rather than a hard dependency on that concrete Android class, so this coordinator's dispatch
 * logic is unit-testable without a `Context`.
 */
class WellbeingRuntimeCoordinator(
    private val dispatcherProvider: () -> WellbeingTriggerDispatcher,
    private val policyStore: WellbeingPolicyStore,
    private val rateStateStore: WellbeingRateStateStore,
    private val monotonicTimeSource: MonotonicTimeSource,
    private val catalogueEntries: List<WellbeingSuggestion>,
    private val deliver: (WellbeingNudgeDelivery, List<WellbeingSuggestion>, Long) -> NudgeDeliveryResult,
) {
    private val lock = Any()

    /**
     * Runs one full trigger cycle: load policy/rate-state, dispatch, persist the updated
     * rate-state, and deliver only if the engine actually selected eligible content (`DELIVERED`
     * with a non-null recommended channel) -- every `SUPPRESSED_*`/`NO_ELIGIBLE_SUGGESTION`
     * outcome (including `SUPPRESSED_PCA_BEDTIME`) is a correct, silent no-op by design, not an
     * error. Synchronized so overlapping triggers (e.g. a screen unlock racing a break
     * transition) can never read-modify-write the same [NudgeRateState] concurrently and lose an
     * update -- correctness matters more than throughput for an event this infrequent.
     */
    fun onTrigger(trigger: NudgeTrigger): NudgeDeliveryStatus = synchronized(lock) {
        val policy = policyStore.load()
        if (!policy.enabled) return NudgeDeliveryStatus.SUPPRESSED_POLICY_DISABLED

        val rateState = rateStateStore.load() ?: NudgeRateState()
        val dispatcher = dispatcherProvider()
        val (selection, updatedRateState) = dispatcher.dispatch(trigger, policy, rateState, catalogueEntries)
        rateStateStore.save(updatedRateState)

        val delivery = selection.recommendedDelivery
        if (selection.status == NudgeDeliveryStatus.DELIVERED && delivery != null && selection.suggestions.isNotEmpty()) {
            deliver(delivery, selection.suggestions, monotonicTimeSource.elapsedRealtimeNanos())
        }
        return selection.status
    }
}
