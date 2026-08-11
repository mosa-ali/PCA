package org.pca.app.feature.wellbeing.engine

import org.pca.app.feature.wellbeing.model.DailyMissionResponse
import org.pca.app.feature.wellbeing.model.WellbeingNudgePolicy
import org.pca.app.feature.wellbeing.model.WellbeingSuggestion

/**
 * One positive mission per calendar day (PCA-WELL-022). DONE/SKIP/NEW_IDEA never punishes and
 * never auto-grants screen time or any other reward -- it is a private, self-reported habit
 * tracker only. Calendar-day boundaries are a legitimate wall-clock use (display/scheduling, not
 * elapsed-time math -- see doc 12's own carve-out for that distinction); [epochDay] is expected to
 * come from a simple wall-clock/calendar port, never used for duration math elsewhere.
 */
data class DailyMissionState(
    val lastMissionEpochDay: Long? = null,
    val lastMissionSuggestionId: String? = null,
    val lastResponse: DailyMissionResponse? = null,
    val completedMissionCount: Int = 0,
)

object DailyMissionEngine {

    /** Deterministically picks today's mission suggestion if one hasn't been picked yet for
     * [epochDay], else returns the existing one -- stable across repeated calls the same day. */
    fun missionForToday(
        state: DailyMissionState,
        epochDay: Long,
        pool: List<WellbeingSuggestion>,
    ): Pair<DailyMissionState, WellbeingSuggestion?> {
        if (state.lastMissionEpochDay == epochDay && state.lastMissionSuggestionId != null) {
            val existing = pool.firstOrNull { it.suggestionId == state.lastMissionSuggestionId }
            if (existing != null) return state to existing
        }
        if (pool.isEmpty()) return state to null
        val index = (epochDay.mod(pool.size.toLong())).toInt()
        val chosen = pool[index]
        return state.copy(lastMissionEpochDay = epochDay, lastMissionSuggestionId = chosen.suggestionId, lastResponse = null) to chosen
    }

    /** Requests a different mission for today (NEW_IDEA) -- still deterministic given the same
     * state, so repeated taps cycle through the pool rather than looping on the same item. */
    fun requestNewIdea(state: DailyMissionState, epochDay: Long, pool: List<WellbeingSuggestion>): Pair<DailyMissionState, WellbeingSuggestion?> {
        if (pool.isEmpty()) return state to null
        val currentIndex = pool.indexOfFirst { it.suggestionId == state.lastMissionSuggestionId }
        val nextIndex = if (currentIndex < 0) 0 else (currentIndex + 1) % pool.size
        val chosen = pool[nextIndex]
        return state.copy(lastMissionEpochDay = epochDay, lastMissionSuggestionId = chosen.suggestionId, lastResponse = null) to chosen
    }

    fun respond(state: DailyMissionState, response: DailyMissionResponse): DailyMissionState = state.copy(
        lastResponse = response,
        completedMissionCount = if (response == DailyMissionResponse.DONE) state.completedMissionCount + 1 else state.completedMissionCount,
    )

    fun eligiblePool(policy: WellbeingNudgePolicy, catalogueEntries: List<WellbeingSuggestion>): List<WellbeingSuggestion> =
        catalogueEntries.filter {
            it.enabledByDefault &&
                it.category in policy.enabledCategories &&
                (it.category != org.pca.app.feature.wellbeing.model.WellbeingCategory.FAITH_POSITIVE || policy.faithContentEnabled)
        }.sortedBy { it.suggestionId }
}
