package org.pca.app.feature.wellbeing.delivery

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.pca.app.feature.wellbeing.catalogue.WellbeingContentCatalogue
import org.pca.app.feature.wellbeing.model.NudgeDeliveryStatus
import org.pca.app.feature.wellbeing.model.WellbeingNudgeDelivery
import org.pca.app.feature.wellbeing.persistence.PendingWellbeingCardStore
import org.pca.app.foundation.InMemoryPersistentStateStore

/**
 * PCA-WELL-012 closure: [WellbeingCardDelivery] is the real adapter that closes the gap
 * `WellbeingNotificationDelivery` deliberately leaves open for IN_APP_CARD/BREAK_SHIELD_CARD/
 * NEXT_UNLOCK_CARD -- previously every one of these three channels returned
 * SUPPRESSED_CAPABILITY_UNAVAILABLE with no rendering surface at all. `launchCardActivity` is a
 * plain function reference in production (`PcaAppGraph::launchWellbeingCardActivity`), so this is
 * fully testable without a `Context`/Robolectric, the same discipline
 * `WellbeingRuntimeCoordinatorTest` already uses for its own `deliver` fake.
 */
class WellbeingCardDeliveryTest {

    private val suggestion = WellbeingContentCatalogue.entries.first()

    private fun buildDelivery(store: PendingWellbeingCardStore = PendingWellbeingCardStore(InMemoryPersistentStateStore())):
        Triple<WellbeingCardDelivery, PendingWellbeingCardStore, MutableList<Unit>> {
        val launches = mutableListOf<Unit>()
        val delivery = WellbeingCardDelivery(
            pendingCardStore = store,
            launchCardActivity = { launches += Unit },
        )
        return Triple(delivery, store, launches)
    }

    @Test
    fun `IN_APP_CARD persists the pending card and launches the Activity immediately`() {
        val (delivery, store, launches) = buildDelivery()

        val result = delivery.deliver(WellbeingNudgeDelivery.IN_APP_CARD, listOf(suggestion), 100L)

        assertEquals(NudgeDeliveryStatus.DELIVERED, result.status)
        assertEquals(1, launches.size)
        assertEquals(WellbeingNudgeDelivery.IN_APP_CARD, store.load()?.delivery)
        assertEquals(listOf(suggestion.suggestionId), store.load()?.suggestionIds)
    }

    @Test
    fun `BREAK_SHIELD_CARD persists the pending card and launches the Activity immediately`() {
        val (delivery, store, launches) = buildDelivery()

        val result = delivery.deliver(WellbeingNudgeDelivery.BREAK_SHIELD_CARD, listOf(suggestion), 200L)

        assertEquals(NudgeDeliveryStatus.DELIVERED, result.status)
        assertEquals(1, launches.size)
        assertEquals(WellbeingNudgeDelivery.BREAK_SHIELD_CARD, store.load()?.delivery)
    }

    @Test
    fun `NEXT_UNLOCK_CARD persists the pending card but does NOT launch the Activity synchronously`() {
        val (delivery, store, launches) = buildDelivery()

        val result = delivery.deliver(WellbeingNudgeDelivery.NEXT_UNLOCK_CARD, listOf(suggestion), 300L)

        assertEquals(NudgeDeliveryStatus.DELIVERED, result.status)
        assertTrue("NEXT_UNLOCK_CARD must never launch synchronously with the trigger", launches.isEmpty())
        assertEquals(WellbeingNudgeDelivery.NEXT_UNLOCK_CARD, store.load()?.delivery)
    }

    @Test
    fun `a non-card channel is suppressed and never touches the pending store or launches anything`() {
        val (delivery, store, launches) = buildDelivery()

        val result = delivery.deliver(WellbeingNudgeDelivery.STANDARD_NOTIFICATION, listOf(suggestion), 400L)

        assertEquals(NudgeDeliveryStatus.SUPPRESSED_CAPABILITY_UNAVAILABLE, result.status)
        assertFalse(launches.isNotEmpty())
        assertEquals(null, store.load())
    }
}
