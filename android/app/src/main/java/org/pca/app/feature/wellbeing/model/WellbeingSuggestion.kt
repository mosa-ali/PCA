package org.pca.app.feature.wellbeing.model

/**
 * One curated (or parent-authored custom) suggestion. Stable across releases: [suggestionId]
 * never changes once shipped, so rate-state/history/feedback records referencing it stay valid.
 *
 * [messageId] names an Android string resource (e.g. "wellbeing_sugg_read_001_en") -- this class
 * is intentionally platform-neutral (pure Kotlin, no `Context`/`Resources` dependency) so it can
 * be reused from a future Kotlin-Multiplatform iOS target; actual copy resolution happens at the
 * UI layer via `WellbeingMessageResolver` (PCA-WELL-021: no hardcoded display strings here).
 */
data class WellbeingSuggestion(
    val suggestionId: String,
    val messageId: String,
    val category: WellbeingCategory,
    val duration: DurationBucket,
    val lockScreenSafe: Boolean,
    val requiresAdultSupervision: Boolean,
    val enabledByDefault: Boolean,
    val version: Int,
    /** True only for the small starter set explicitly reachable from GIVE_ME_AN_IDEA without a
     * trigger context (child-initiated, always available offline). */
    val childInitiable: Boolean = true,
    /** True for parent-authored custom content (PCA-WELL-018); false for curated catalogue. */
    val isCustom: Boolean = false,
    /** BCP-47-ish tag, e.g. "en" or "ar" -- required for custom suggestions since they are not
     * mirrored into both languages the way catalogue content is. */
    val languageTag: String = "en",
) {
    init {
        require(suggestionId.isNotBlank()) { "suggestionId must not be blank" }
        require(messageId.isNotBlank()) { "messageId must not be blank" }
        require(languageTag.isNotBlank()) { "languageTag must not be blank" }
    }
}

/** A custom suggestion pending safety review cannot be selected/delivered yet (PCA-WELL-018). */
enum class CustomSuggestionReviewState {
    DEFERRED_PENDING_CONTENT_SAFETY_REVIEW,
    APPROVED,
    REJECTED_UNSAFE,
}
