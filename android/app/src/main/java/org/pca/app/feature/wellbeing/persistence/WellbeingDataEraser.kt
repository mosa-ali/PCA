package org.pca.app.feature.wellbeing.persistence

/**
 * Retention / Delete-Now purge hook for this workstream's local data (PCA-WELL-020, doc 11). No
 * Android-side "Delete Now" orchestrator exists yet in this baseline for other lanes to have
 * wired into (see the Coordinator integration queue in the PCA-WELL-1 final report) -- this class
 * is that hook, ready to be called by one once it lands. Purging removes policy, rate/game-return
 * state, and all custom suggestions; there is no resurrection path (doc 11) -- once called, a
 * fresh install-equivalent default state is what `WellbeingPolicyStore.load()` / rate-state
 * loaders return next.
 */
class WellbeingDataEraser(
    private val policyStore: WellbeingPolicyStore,
    private val rateStateStore: WellbeingRateStateStore,
    private val customSuggestionStore: CustomSuggestionStore,
    private val dailyMissionStateStore: DailyMissionStateStore,
) {
    fun purgeAll() {
        policyStore.clear()
        rateStateStore.clear()
        customSuggestionStore.clear()
        dailyMissionStateStore.clear()
    }
}
