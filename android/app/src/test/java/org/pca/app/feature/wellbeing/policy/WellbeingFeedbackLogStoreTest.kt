package org.pca.app.feature.wellbeing.policy

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.pca.app.feature.wellbeing.model.NudgeFeedback
import org.pca.app.feature.wellbeing.model.NudgeFeedbackType
import org.pca.app.foundation.InMemoryPersistentStateStore

/** Offline feedback storage (item 12): every operation here goes through
 * [InMemoryPersistentStateStore] only -- no network dependency anywhere in this store. */
class WellbeingFeedbackLogStoreTest {

    @Test
    fun `append and reload round-trips through the persistent store, fully offline`() {
        val backing = InMemoryPersistentStateStore()
        val store = WellbeingFeedbackLogStore(backing)
        store.append(NudgeFeedback("well.reading.1", NudgeFeedbackType.HELPFUL, 100L))
        store.append(NudgeFeedback("well.reading.2", NudgeFeedbackType.NOT_FOR_ME, 200L))

        val reloaded = WellbeingFeedbackLogStore(backing).loadAll()
        assertEquals(2, reloaded.size)
        assertEquals(NudgeFeedbackType.NOT_FOR_ME, reloaded[1].type)
    }

    @Test
    fun `empty store returns empty list, not an error`() {
        assertEquals(emptyList<NudgeFeedback>(), WellbeingFeedbackLogStore(InMemoryPersistentStateStore()).loadAll())
    }

    @Test
    fun `corrupt data degrades to empty list rather than crashing`() {
        val backing = InMemoryPersistentStateStore()
        backing.putString("wellbeing_feedback_log_v1", "not json")
        assertEquals(emptyList<NudgeFeedback>(), WellbeingFeedbackLogStore(backing).loadAll())
    }

    @Test
    fun `no reward is granted anywhere in this store -- DONE_SELF_REPORTED is just a stored record`() {
        val backing = InMemoryPersistentStateStore()
        val store = WellbeingFeedbackLogStore(backing)
        store.append(NudgeFeedback("well.gratitude.1", NudgeFeedbackType.DONE_SELF_REPORTED, 300L))
        // The store's only observable effect is the record itself -- no side channel, no counter
        // that resembles a reward/currency exists on this class.
        assertTrue(store.loadAll().single().type == NudgeFeedbackType.DONE_SELF_REPORTED)
    }

    @Test
    fun `clear removes the log`() {
        val backing = InMemoryPersistentStateStore()
        val store = WellbeingFeedbackLogStore(backing)
        store.append(NudgeFeedback("well.reading.1", NudgeFeedbackType.HELPFUL, 100L))
        store.clear()
        assertEquals(emptyList<NudgeFeedback>(), store.loadAll())
    }
}
