package org.pca.app.feature.wellbeing.catalogue

import org.pca.app.feature.wellbeing.model.DurationBucket
import org.pca.app.feature.wellbeing.model.WellbeingCategory
import org.pca.app.feature.wellbeing.model.WellbeingSuggestion

/**
 * The curated EN+AR content catalogue (PCA-WELL-006). Each entry's [WellbeingSuggestion.messageId]
 * names an Android string resource present in BOTH `res/values/strings.xml` (English) and
 * `res/values-ar/strings.xml` (Arabic) -- see `WellbeingContentCatalogueTest` for the check that
 * enforces this pairing never drifts. Copy itself lives only in those resource files; nothing
 * user-visible is hardcoded here (PCA-WELL-021).
 *
 * Content-tone quality gate (PCA-WELL-002): every entry here was written to avoid shame, threat,
 * guilt, comparison, or punishment framing. `MOVEMENT_RESET` entries never reference calories,
 * weight, or "burning off" screen time (PCA-WELL-025). Anything hazardous in `HOME_RESPONSIBILITY`
 * (heat sources, sharp tools, cleaning chemicals) is marked [WellbeingSuggestion.requiresAdultSupervision]
 * (PCA-WELL-026).
 *
 * [WellbeingCategory.CHILD_SELECTED_FAVORITES] deliberately has NO pre-authored entries here: it
 * is a dynamic category synthesized at selection time from suggestions the child has previously
 * marked HELPFUL (see `NudgeSelectionEngine.favoritesFor`), not fixed authored content.
 */
object WellbeingContentCatalogue {

    private fun s(
        id: String,
        category: WellbeingCategory,
        duration: DurationBucket,
        lockScreenSafe: Boolean = true,
        requiresAdultSupervision: Boolean = false,
        enabledByDefault: Boolean = true,
    ) = WellbeingSuggestion(
        suggestionId = "well.$id",
        messageId = "wellbeing_sugg_${id.replace('.', '_')}",
        category = category,
        duration = duration,
        lockScreenSafe = lockScreenSafe,
        requiresAdultSupervision = requiresAdultSupervision,
        enabledByDefault = enabledByDefault,
        version = 1,
    )

    val entries: List<WellbeingSuggestion> = listOf(
        // SKILLS_AND_LEARNING
        s("skills.1", WellbeingCategory.SKILLS_AND_LEARNING, DurationBucket.SHORT_2_5_MIN),
        s("skills.2", WellbeingCategory.SKILLS_AND_LEARNING, DurationBucket.MEDIUM_5_15_MIN),
        s("skills.3", WellbeingCategory.SKILLS_AND_LEARNING, DurationBucket.MEDIUM_5_15_MIN),
        s("skills.4", WellbeingCategory.SKILLS_AND_LEARNING, DurationBucket.LONG_15_30_MIN),
        s("skills.5", WellbeingCategory.SKILLS_AND_LEARNING, DurationBucket.SHORT_2_5_MIN),

        // READING
        s("reading.1", WellbeingCategory.READING, DurationBucket.SHORT_2_5_MIN),
        s("reading.2", WellbeingCategory.READING, DurationBucket.MEDIUM_5_15_MIN),
        s("reading.3", WellbeingCategory.READING, DurationBucket.MEDIUM_5_15_MIN),
        s("reading.4", WellbeingCategory.READING, DurationBucket.LONG_15_30_MIN),
        s("reading.5", WellbeingCategory.READING, DurationBucket.SHORT_2_5_MIN),

        // FAITH_POSITIVE (optional, never a gate -- PCA-WELL-004)
        s("faith.1", WellbeingCategory.FAITH_POSITIVE, DurationBucket.SHORT_2_5_MIN),
        s("faith.2", WellbeingCategory.FAITH_POSITIVE, DurationBucket.SHORT_2_5_MIN),
        s("faith.3", WellbeingCategory.FAITH_POSITIVE, DurationBucket.MEDIUM_5_15_MIN),
        s("faith.4", WellbeingCategory.FAITH_POSITIVE, DurationBucket.MEDIUM_5_15_MIN),
        s("faith.5", WellbeingCategory.FAITH_POSITIVE, DurationBucket.SHORT_2_5_MIN, enabledByDefault = false),

        // GRATITUDE
        s("gratitude.1", WellbeingCategory.GRATITUDE, DurationBucket.SHORT_2_5_MIN),
        s("gratitude.2", WellbeingCategory.GRATITUDE, DurationBucket.SHORT_2_5_MIN),
        s("gratitude.3", WellbeingCategory.GRATITUDE, DurationBucket.MEDIUM_5_15_MIN),
        s("gratitude.4", WellbeingCategory.GRATITUDE, DurationBucket.SHORT_2_5_MIN),
        s("gratitude.5", WellbeingCategory.GRATITUDE, DurationBucket.MEDIUM_5_15_MIN),

        // GOOD_DEED
        s("gooddeed.1", WellbeingCategory.GOOD_DEED, DurationBucket.SHORT_2_5_MIN),
        s("gooddeed.2", WellbeingCategory.GOOD_DEED, DurationBucket.MEDIUM_5_15_MIN),
        s("gooddeed.3", WellbeingCategory.GOOD_DEED, DurationBucket.MEDIUM_5_15_MIN),
        s("gooddeed.4", WellbeingCategory.GOOD_DEED, DurationBucket.SHORT_2_5_MIN),
        s("gooddeed.5", WellbeingCategory.GOOD_DEED, DurationBucket.LONG_15_30_MIN),

        // FAMILY_HELP
        s("familyhelp.1", WellbeingCategory.FAMILY_HELP, DurationBucket.SHORT_2_5_MIN),
        s("familyhelp.2", WellbeingCategory.FAMILY_HELP, DurationBucket.MEDIUM_5_15_MIN),
        s("familyhelp.3", WellbeingCategory.FAMILY_HELP, DurationBucket.MEDIUM_5_15_MIN),
        s("familyhelp.4", WellbeingCategory.FAMILY_HELP, DurationBucket.SHORT_2_5_MIN),
        s("familyhelp.5", WellbeingCategory.FAMILY_HELP, DurationBucket.LONG_15_30_MIN),

        // HOME_RESPONSIBILITY (hazardous tasks require adult supervision -- PCA-WELL-026)
        s("homeresp.1", WellbeingCategory.HOME_RESPONSIBILITY, DurationBucket.SHORT_2_5_MIN),
        s("homeresp.2", WellbeingCategory.HOME_RESPONSIBILITY, DurationBucket.MEDIUM_5_15_MIN),
        s(
            "homeresp.3", WellbeingCategory.HOME_RESPONSIBILITY, DurationBucket.MEDIUM_5_15_MIN,
            requiresAdultSupervision = true,
        ),
        s("homeresp.4", WellbeingCategory.HOME_RESPONSIBILITY, DurationBucket.SHORT_2_5_MIN),
        s(
            "homeresp.5", WellbeingCategory.HOME_RESPONSIBILITY, DurationBucket.MEDIUM_5_15_MIN,
            requiresAdultSupervision = true,
        ),

        // CREATIVITY
        s("creativity.1", WellbeingCategory.CREATIVITY, DurationBucket.SHORT_2_5_MIN),
        s("creativity.2", WellbeingCategory.CREATIVITY, DurationBucket.MEDIUM_5_15_MIN),
        s("creativity.3", WellbeingCategory.CREATIVITY, DurationBucket.MEDIUM_5_15_MIN),
        s("creativity.4", WellbeingCategory.CREATIVITY, DurationBucket.LONG_15_30_MIN),
        s("creativity.5", WellbeingCategory.CREATIVITY, DurationBucket.SHORT_2_5_MIN),

        // MOVEMENT_RESET (no calories/weight/punitive framing -- PCA-WELL-025)
        s("movement.1", WellbeingCategory.MOVEMENT_RESET, DurationBucket.SHORT_2_5_MIN),
        s("movement.2", WellbeingCategory.MOVEMENT_RESET, DurationBucket.SHORT_2_5_MIN),
        s("movement.3", WellbeingCategory.MOVEMENT_RESET, DurationBucket.MEDIUM_5_15_MIN),
        s("movement.4", WellbeingCategory.MOVEMENT_RESET, DurationBucket.SHORT_2_5_MIN),
        s("movement.5", WellbeingCategory.MOVEMENT_RESET, DurationBucket.MEDIUM_5_15_MIN),

        // REST_AND_RESET
        s("rest.1", WellbeingCategory.REST_AND_RESET, DurationBucket.SHORT_2_5_MIN),
        s("rest.2", WellbeingCategory.REST_AND_RESET, DurationBucket.SHORT_2_5_MIN),
        s("rest.3", WellbeingCategory.REST_AND_RESET, DurationBucket.MEDIUM_5_15_MIN),
        s("rest.4", WellbeingCategory.REST_AND_RESET, DurationBucket.MEDIUM_5_15_MIN),
        s("rest.5", WellbeingCategory.REST_AND_RESET, DurationBucket.SHORT_2_5_MIN),

        // OUTDOOR_OR_OFFSCREEN (not lock-screen-safe topic-wise but text itself is fine; kept safe)
        s("outdoor.1", WellbeingCategory.OUTDOOR_OR_OFFSCREEN, DurationBucket.MEDIUM_5_15_MIN),
        s("outdoor.2", WellbeingCategory.OUTDOOR_OR_OFFSCREEN, DurationBucket.MEDIUM_5_15_MIN),
        s("outdoor.3", WellbeingCategory.OUTDOOR_OR_OFFSCREEN, DurationBucket.LONG_15_30_MIN),
        s("outdoor.4", WellbeingCategory.OUTDOOR_OR_OFFSCREEN, DurationBucket.SHORT_2_5_MIN),
        s("outdoor.5", WellbeingCategory.OUTDOOR_OR_OFFSCREEN, DurationBucket.LONG_15_30_MIN),

        // PLANNING_AND_ORGANIZATION
        s("planning.1", WellbeingCategory.PLANNING_AND_ORGANIZATION, DurationBucket.SHORT_2_5_MIN),
        s("planning.2", WellbeingCategory.PLANNING_AND_ORGANIZATION, DurationBucket.MEDIUM_5_15_MIN),
        s("planning.3", WellbeingCategory.PLANNING_AND_ORGANIZATION, DurationBucket.MEDIUM_5_15_MIN),
        s("planning.4", WellbeingCategory.PLANNING_AND_ORGANIZATION, DurationBucket.SHORT_2_5_MIN),
        s("planning.5", WellbeingCategory.PLANNING_AND_ORGANIZATION, DurationBucket.LONG_15_30_MIN),
    )

    /** Suggestions eligible to show directly on a locked/secure surface (generic copy only --
     * the actual lock-screen text used is always the fixed redacted string, never this content,
     * but this flag also gates NEXT_UNLOCK_CARD eagerness). */
    fun lockScreenSafeEntries(): List<WellbeingSuggestion> = entries.filter { it.lockScreenSafe }

    fun byCategory(category: WellbeingCategory): List<WellbeingSuggestion> =
        entries.filter { it.category == category }

    fun byId(suggestionId: String): WellbeingSuggestion? = entries.firstOrNull { it.suggestionId == suggestionId }
}
