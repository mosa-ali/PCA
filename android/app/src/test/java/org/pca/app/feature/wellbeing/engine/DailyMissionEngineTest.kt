package org.pca.app.feature.wellbeing.engine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test
import org.pca.app.feature.wellbeing.catalogue.WellbeingContentCatalogue
import org.pca.app.feature.wellbeing.model.DailyMissionResponse
import org.pca.app.feature.wellbeing.model.WellbeingNudgePolicy

class DailyMissionEngineTest {

    private val pool = DailyMissionEngine.eligiblePool(WellbeingNudgePolicy(), WellbeingContentCatalogue.entries)

    @Test
    fun `same day returns the same mission`() {
        val (state1, mission1) = DailyMissionEngine.missionForToday(DailyMissionState(), epochDay = 100L, pool)
        val (_, mission2) = DailyMissionEngine.missionForToday(state1, epochDay = 100L, pool)
        assertEquals(mission1?.suggestionId, mission2?.suggestionId)
    }

    @Test
    fun `next day advances the recorded mission day`() {
        val (state1, _) = DailyMissionEngine.missionForToday(DailyMissionState(), epochDay = 100L, pool)
        val (state2, _) = DailyMissionEngine.missionForToday(state1, epochDay = 101L, pool)
        assertEquals(101L, state2.lastMissionEpochDay)
    }

    @Test
    fun `NEW_IDEA cycles to a different suggestion`() {
        val (state1, mission1) = DailyMissionEngine.missionForToday(DailyMissionState(), epochDay = 100L, pool)
        val (state2, mission2) = DailyMissionEngine.requestNewIdea(state1, epochDay = 100L, pool)
        assertNotEquals(mission1?.suggestionId, mission2?.suggestionId)
        assertEquals(state2.lastMissionSuggestionId, mission2?.suggestionId)
    }

    @Test
    fun `DONE never grants anything -- it only increments a private local counter`() {
        var state = DailyMissionState()
        state = DailyMissionEngine.respond(state, DailyMissionResponse.DONE)
        assertEquals(1, state.completedMissionCount)
        state = DailyMissionEngine.respond(state, DailyMissionResponse.SKIP)
        assertEquals(1, state.completedMissionCount)
    }
}
