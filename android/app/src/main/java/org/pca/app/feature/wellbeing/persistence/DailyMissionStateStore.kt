package org.pca.app.feature.wellbeing.persistence

import org.pca.app.feature.wellbeing.engine.DailyMissionState
import org.pca.app.feature.wellbeing.model.DailyMissionResponse
import org.pca.app.foundation.PersistentStateStore

class DailyMissionStateStore(
    private val store: PersistentStateStore,
    private val key: String = KEY,
) {
    fun save(state: DailyMissionState) {
        val fields = listOf(
            state.lastMissionEpochDay?.toString() ?: NULL,
            state.lastMissionSuggestionId ?: NULL,
            state.lastResponse?.name ?: NULL,
            state.completedMissionCount.toString(),
        )
        store.putString(key, fields.joinToString(SEP))
    }

    fun load(): DailyMissionState {
        val raw = store.getString(key) ?: return DailyMissionState()
        val parts = raw.split(SEP, limit = 4)
        if (parts.size != 4) return DailyMissionState()
        return try {
            DailyMissionState(
                lastMissionEpochDay = parts[0].takeIf { it != NULL }?.toLong(),
                lastMissionSuggestionId = parts[1].takeIf { it != NULL },
                lastResponse = parts[2].takeIf { it != NULL }?.let { DailyMissionResponse.valueOf(it) },
                completedMissionCount = parts[3].toInt(),
            )
        } catch (_: IllegalArgumentException) {
            DailyMissionState()
        }
    }

    fun clear() {
        store.remove(key)
    }

    private companion object {
        const val KEY = "wellbeing_daily_mission_v1"
        const val SEP = "|"
        const val NULL = "NULL"
    }
}
