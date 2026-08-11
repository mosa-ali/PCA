package org.pca.app.feature.wellbeing.ui

import org.pca.app.feature.wellbeing.model.DailyMissionResponse
import org.pca.app.feature.wellbeing.model.WellbeingSuggestion

/** What an IN_APP_CARD / NEXT_UNLOCK_CARD / BREAK_SHIELD_CARD surface needs to render. Text is
 * already resolved (via `WellbeingMessageResolver`) by the caller -- this layer is pure UI state,
 * no resource lookups, so it stays trivially testable. */
data class WellbeingCardViewState(
    val suggestions: List<Pair<WellbeingSuggestion, String>>,
    val canSnooze: Boolean,
    val canMarkNotHelpful: Boolean,
)

data class GameReturnCardViewState(
    val bodyText: String,
)

data class DailyMissionCardViewState(
    val missionText: String?,
    val response: DailyMissionResponse?,
)

data class ReflectionPromptViewState(
    val bodyText: String,
)
