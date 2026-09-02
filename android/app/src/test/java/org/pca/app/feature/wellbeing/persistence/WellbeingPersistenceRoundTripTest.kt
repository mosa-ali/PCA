package org.pca.app.feature.wellbeing.persistence

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.pca.app.feature.wellbeing.engine.DailyMissionState
import org.pca.app.feature.wellbeing.model.CustomSuggestionReviewState
import org.pca.app.feature.wellbeing.model.DailyMissionResponse
import org.pca.app.feature.wellbeing.model.DurationBucket
import org.pca.app.feature.wellbeing.model.NudgeRateState
import org.pca.app.feature.wellbeing.model.WellbeingCategory
import org.pca.app.feature.wellbeing.model.WellbeingNudgeDelivery
import org.pca.app.feature.wellbeing.model.WellbeingNudgePolicy
import org.pca.app.foundation.InMemoryPersistentStateStore

/** Offline persistence: every store here is backed only by [InMemoryPersistentStateStore] /
 * `PersistentStateStore`, exercised with no network or platform dependency -- covers the "offline"
 * item of the test matrix for the persistence layer. */
class WellbeingPersistenceRoundTripTest {

    @Test
    fun `policy store round-trips all fields`() {
        val store = WellbeingPolicyStore(InMemoryPersistentStateStore())
        val policy = WellbeingNudgePolicy(
            enabled = false,
            enabledCategories = setOf(WellbeingCategory.READING, WellbeingCategory.GRATITUDE),
            faithContentEnabled = false,
            quietHoursStartMinuteOfDay = 60,
            quietHoursEndMinuteOfDay = 300,
            maximumDailyNudges = 9,
            durationPreferences = setOf(DurationBucket.SHORT_2_5_MIN),
        )
        store.save(policy)
        assertEquals(policy, store.load())
    }

    @Test
    fun `policy store returns default when nothing saved`() {
        val store = WellbeingPolicyStore(InMemoryPersistentStateStore())
        assertEquals(WellbeingNudgePolicy(), store.load())
    }

    @Test
    fun `policy store clear removes data and Delete Now purges everything`() {
        val backing = InMemoryPersistentStateStore()
        val policyStore = WellbeingPolicyStore(backing)
        val rateStore = WellbeingRateStateStore(backing)
        val customStore = CustomSuggestionStore(backing)
        val missionStore = DailyMissionStateStore(backing)

        policyStore.save(WellbeingNudgePolicy(enabled = false))
        rateStore.save(NudgeRateState(dailyNudgeCount = 5))
        customStore.add("Water the plants together", WellbeingCategory.FAMILY_HELP, DurationBucket.SHORT_2_5_MIN, "en")
        missionStore.save(DailyMissionState(completedMissionCount = 2))

        WellbeingDataEraser(policyStore, rateStore, customStore, missionStore).purgeAll()

        assertEquals(WellbeingNudgePolicy(), policyStore.load())
        assertNull(rateStore.load())
        assertEquals(emptyList<Any>(), customStore.loadAll())
        assertEquals(DailyMissionState(), missionStore.load())
    }

    @Test
    fun `rate state store round-trips including maps and lists`() {
        val store = WellbeingRateStateStore(InMemoryPersistentStateStore())
        val state = NudgeRateState(
            lastEligibleAppToken = "app_1",
            lastEligibleExitMonotonicNanos = 123L,
            dayWindowAnchorMonotonicNanos = 456L,
            dailyNudgeCount = 2,
            recentSuggestionIds = listOf("well.reading.1", "well.gratitude.2"),
            lastDeliveredAtBySuggestionId = mapOf("well.reading.1" to 789L),
            notForMeUntilBySuggestionId = mapOf("well.gratitude.2" to 999L),
            rapidReentryCount = 1,
            lastBootGenerationToken = "boot-9",
        )
        store.save(state)
        assertEquals(state, store.load())
    }

    @Test
    fun `custom suggestion store starts every entry as DEFERRED_PENDING_CONTENT_SAFETY_REVIEW`() {
        val store = CustomSuggestionStore(InMemoryPersistentStateStore())
        val result = store.add("Help fold the laundry with mom", WellbeingCategory.FAMILY_HELP, DurationBucket.SHORT_2_5_MIN, "en")
        val added = result as CustomSuggestionStore.AddResult.Added
        assertEquals(CustomSuggestionReviewState.DEFERRED_PENDING_CONTENT_SAFETY_REVIEW, added.entry.reviewState)
        assertEquals(emptyList<Any>(), store.approvedSuggestions())

        store.setReviewState(added.entry.suggestion.suggestionId, CustomSuggestionReviewState.APPROVED)
        assertEquals(1, store.approvedSuggestions().size)
    }

    @Test
    fun `pending wellbeing card store round-trips`() {
        val store = PendingWellbeingCardStore(InMemoryPersistentStateStore())
        val card = PendingWellbeingCard(
            delivery = WellbeingNudgeDelivery.NEXT_UNLOCK_CARD,
            suggestionIds = listOf("well.reading.1", "well.gratitude.2"),
            queuedAtMonotonicNanos = 42L,
        )
        store.save(card)
        assertEquals(card, store.load())
    }

    @Test
    fun `pending wellbeing card store returns null when nothing saved`() {
        val store = PendingWellbeingCardStore(InMemoryPersistentStateStore())
        assertNull(store.load())
    }

    @Test
    fun `pending wellbeing card store clear removes the pending card`() {
        val store = PendingWellbeingCardStore(InMemoryPersistentStateStore())
        store.save(PendingWellbeingCard(WellbeingNudgeDelivery.IN_APP_CARD, listOf("well.reading.1"), 1L))

        store.clear()

        assertNull(store.load())
    }

    @Test
    fun `daily mission state store round-trips`() {
        val store = DailyMissionStateStore(InMemoryPersistentStateStore())
        val state = DailyMissionState(
            lastMissionEpochDay = 19876L,
            lastMissionSuggestionId = "well.gratitude.1",
            lastResponse = DailyMissionResponse.DONE,
            completedMissionCount = 4,
        )
        store.save(state)
        assertEquals(state, store.load())
    }
}
