package org.pca.app.feature.wellbeing.model

/** Result of running the selection engine for a given [NudgeTriggerContext]. */
data class NudgeSelection(
    val status: NudgeDeliveryStatus,
    val suggestions: List<WellbeingSuggestion>,
    val recommendedDelivery: WellbeingNudgeDelivery?,
)

/** Result of attempting to actually deliver a [NudgeSelection] through a channel. */
data class NudgeDeliveryResult(
    val status: NudgeDeliveryStatus,
    val delivery: WellbeingNudgeDelivery,
    val deliveredAtMonotonicNanos: Long,
    val suggestionIds: List<String>,
)

/** Self-reported child feedback record (PCA-WELL-005). Purely local unless policy explicitly
 * syncs aggregate-only summaries; never carries which specific suggestion was rejected outward
 * when [WellbeingNudgePolicy.privacyMode] is on (PCA-WELL-017). */
data class NudgeFeedback(
    val suggestionId: String,
    val type: NudgeFeedbackType,
    val atMonotonicNanos: Long,
)

/** Aggregate-only counts safe to show a parent even under `privacyMode` (PCA-WELL-017): never
 * which specific suggestion was rejected, only totals. */
data class NudgeAggregateSummary(
    val periodLabel: String,
    val nudgesDelivered: Int,
    val nudgesMarkedHelpful: Int,
    val nudgesMarkedNotForMe: Int,
    val selfReportedDoneCount: Int,
    val categoryCounts: Map<WellbeingCategory, Int>,
)
