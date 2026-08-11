package org.pca.app.feature.wellbeing.engine

import org.junit.Assert.assertEquals
import org.junit.Test
import org.pca.app.feature.wellbeing.catalogue.WellbeingContentCatalogue
import org.pca.app.feature.wellbeing.model.NudgeFeedback
import org.pca.app.feature.wellbeing.model.NudgeFeedbackType
import org.pca.app.feature.wellbeing.model.WellbeingCategory

class WellbeingAggregateSummaryBuilderTest {

    @Test
    fun `aggregate counts totals without exposing which suggestion was rejected`() {
        val readingId = WellbeingContentCatalogue.byCategory(WellbeingCategory.READING).first().suggestionId
        val gratitudeId = WellbeingContentCatalogue.byCategory(WellbeingCategory.GRATITUDE).first().suggestionId

        val log = listOf(
            NudgeFeedback(readingId, NudgeFeedbackType.HELPFUL, 1L),
            NudgeFeedback(gratitudeId, NudgeFeedbackType.NOT_FOR_ME, 2L),
            NudgeFeedback(readingId, NudgeFeedbackType.DONE_SELF_REPORTED, 3L),
        )
        val summary = WellbeingAggregateSummaryBuilder.build("this week", log)

        assertEquals(1, summary.nudgesMarkedHelpful)
        assertEquals(1, summary.nudgesMarkedNotForMe)
        assertEquals(1, summary.selfReportedDoneCount)
        assertEquals(2, summary.nudgesDelivered)
        // The summary is category-level aggregate only -- it structurally cannot name which
        // specific suggestion within GRATITUDE was marked NOT_FOR_ME (PCA-WELL-017).
        assertEquals(1, summary.categoryCounts[WellbeingCategory.GRATITUDE])
    }
}
