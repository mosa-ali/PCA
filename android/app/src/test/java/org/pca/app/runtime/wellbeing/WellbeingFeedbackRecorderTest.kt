package org.pca.app.runtime.wellbeing

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.pca.app.feature.wellbeing.model.NudgeFeedbackType
import org.pca.app.feature.wellbeing.model.WellbeingNudgePolicy
import org.pca.app.feature.wellbeing.persistence.WellbeingPolicyStore
import org.pca.app.feature.wellbeing.persistence.WellbeingRateStateStore
import org.pca.app.feature.wellbeing.policy.WellbeingFeedbackLogStore
import org.pca.app.foundation.InMemoryPersistentStateStore
import org.pca.app.runtime.FakeMonotonicTimeSource

/**
 * PCA-WELL-012 closure: [WellbeingFeedbackRecorder] is the real production caller of
 * [WellbeingFeedbackLogStore.append] and
 * [org.pca.app.feature.wellbeing.engine.NudgeSelectionEngine.applyFeedback] -- both real,
 * unit-tested, but called from nowhere in `src/main` until this class existed. Fully testable
 * against [InMemoryPersistentStateStore] with no `Context`/Robolectric dependency, same discipline
 * `WellbeingRuntimeCoordinatorTest` already uses for its own real-call-chain proofs.
 */
class WellbeingFeedbackRecorderTest {

    private fun buildRecorder(
        store: InMemoryPersistentStateStore = InMemoryPersistentStateStore(),
        monotonic: FakeMonotonicTimeSource = FakeMonotonicTimeSource(),
    ) = Triple(
        WellbeingFeedbackRecorder(
            feedbackLogStore = WellbeingFeedbackLogStore(store),
            policyStore = WellbeingPolicyStore(store),
            rateStateStore = WellbeingRateStateStore(store),
            monotonicTimeSource = monotonic,
        ),
        store,
        monotonic,
    )

    @Test
    fun `record appends a durable feedback log entry`() {
        val (recorder, store, monotonic) = buildRecorder()
        monotonic.nowNanos = 500L

        recorder.record("well.reading.1", NudgeFeedbackType.HELPFUL)

        val entries = WellbeingFeedbackLogStore(store).loadAll()
        assertEquals(1, entries.size)
        assertEquals("well.reading.1", entries.first().suggestionId)
        assertEquals(NudgeFeedbackType.HELPFUL, entries.first().type)
        assertEquals(500L, entries.first().atMonotonicNanos)
    }

    @Test
    fun `record folds NOT_FOR_ME into the durable rate state so it is really suppressed going forward`() {
        val (recorder, store, monotonic) = buildRecorder()
        WellbeingPolicyStore(store).save(WellbeingNudgePolicy())
        monotonic.nowNanos = 1_000L

        recorder.record("well.reading.1", NudgeFeedbackType.NOT_FOR_ME)

        val rateState = WellbeingRateStateStore(store).load()
        assertTrue(rateState != null && rateState.notForMeUntilBySuggestionId.containsKey("well.reading.1"))
        assertTrue(rateState!!.notForMeUntilBySuggestionId.getValue("well.reading.1") > monotonic.nowNanos)
    }

    @Test
    fun `record for a feedback type other than NOT_FOR_ME still logs but does not suppress`() {
        val (recorder, store, _) = buildRecorder()

        recorder.record("well.reading.1", NudgeFeedbackType.HELPFUL)

        assertEquals(1, WellbeingFeedbackLogStore(store).loadAll().size)
        val rateState = WellbeingRateStateStore(store).load()
        assertTrue(rateState != null && !rateState.notForMeUntilBySuggestionId.containsKey("well.reading.1"))
    }
}
