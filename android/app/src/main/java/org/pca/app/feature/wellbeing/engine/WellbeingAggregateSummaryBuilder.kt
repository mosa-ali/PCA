package org.pca.app.feature.wellbeing.engine

import org.pca.app.feature.wellbeing.catalogue.WellbeingContentCatalogue
import org.pca.app.feature.wellbeing.model.NudgeAggregateSummary
import org.pca.app.feature.wellbeing.model.NudgeFeedback
import org.pca.app.feature.wellbeing.model.NudgeFeedbackType
import org.pca.app.feature.wellbeing.model.WellbeingCategory

/**
 * Builds aggregate-only summaries safe to display to a child (simple counts, PCA-WELL brief's
 * "optional child-facing healthy-balance summary" -- no grades, rankings, red scores, or sibling
 * comparison) and, under [org.pca.app.feature.wellbeing.model.WellbeingNudgePolicy.privacyMode],
 * safe to preview to a parent too: totals only, never which specific suggestion a child rejected
 * (PCA-WELL-017).
 */
object WellbeingAggregateSummaryBuilder {

    fun build(periodLabel: String, feedbackLog: List<NudgeFeedback>): NudgeAggregateSummary {
        val categoryCounts = mutableMapOf<WellbeingCategory, Int>()
        for (fb in feedbackLog) {
            val category = WellbeingContentCatalogue.byId(fb.suggestionId)?.category ?: continue
            categoryCounts[category] = (categoryCounts[category] ?: 0) + 1
        }
        return NudgeAggregateSummary(
            periodLabel = periodLabel,
            nudgesDelivered = feedbackLog.map { it.suggestionId }.distinct().size,
            nudgesMarkedHelpful = feedbackLog.count { it.type == NudgeFeedbackType.HELPFUL },
            nudgesMarkedNotForMe = feedbackLog.count { it.type == NudgeFeedbackType.NOT_FOR_ME },
            selfReportedDoneCount = feedbackLog.count { it.type == NudgeFeedbackType.DONE_SELF_REPORTED },
            categoryCounts = categoryCounts,
        )
    }
}
