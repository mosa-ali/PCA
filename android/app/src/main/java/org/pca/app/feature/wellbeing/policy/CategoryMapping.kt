package org.pca.app.feature.wellbeing.policy

import org.pca.app.feature.wellbeing.model.WellbeingCategory

/**
 * The single explicit mapping layer between the parent-SDK's [SdkWellbeingCategory] (types.ts,
 * doc 36 section 5.2) and the Android runtime's canonical [WellbeingCategory] (doc 35
 * PCA-WELL-006). See doc 38 for the full evidence trail; summary:
 *
 * - Android's `feature/wellbeing` runtime (doc 35) is canonical: it is the older, richer, 13-value
 *   taxonomy actually consumed by [org.pca.app.feature.wellbeing.engine.NudgeSelectionEngine],
 *   the curated catalogue, and the parent policy screen.
 * - Doc 36 section 1 explicitly states the parent-authoring domain "aligns terminology... with
 *   WELL-1" and "does not modify WELL-1's runtime engine" -- i.e. it was designed to *follow*
 *   Android's taxonomy, not replace it. No source evidence favors the SDK's generic `CUSTOM`
 *   catch-all as canonical.
 * - 12 of the SDK's 13 categories map 1:1 to Android by name and meaning.
 * - The SDK's `CUSTOM` has no Android equivalent among the original 13 -- it is a generic bucket
 *   for parent-authored content that doesn't fit anything else. Android's [WellbeingCategory] was
 *   extended with [WellbeingCategory.PARENT_CUSTOM_OTHER] to receive it (additive-only change;
 *   no existing category's meaning changed).
 * - Android's [WellbeingCategory.CHILD_SELECTED_FAVORITES] has no SDK equivalent -- it is a
 *   dynamic, engine-synthesized bucket (favorites derived from HELPFUL feedback) that a parent
 *   never authors content into, so the SDK contract has no reason to name it.
 */
object CategoryMapping {

    private val SDK_TO_ANDROID: Map<SdkWellbeingCategory, WellbeingCategory> = mapOf(
        SdkWellbeingCategory.SKILLS_AND_LEARNING to WellbeingCategory.SKILLS_AND_LEARNING,
        SdkWellbeingCategory.READING to WellbeingCategory.READING,
        SdkWellbeingCategory.FAITH_POSITIVE to WellbeingCategory.FAITH_POSITIVE,
        SdkWellbeingCategory.GRATITUDE to WellbeingCategory.GRATITUDE,
        SdkWellbeingCategory.GOOD_DEED to WellbeingCategory.GOOD_DEED,
        SdkWellbeingCategory.FAMILY_HELP to WellbeingCategory.FAMILY_HELP,
        SdkWellbeingCategory.HOME_RESPONSIBILITY to WellbeingCategory.HOME_RESPONSIBILITY,
        SdkWellbeingCategory.CREATIVITY to WellbeingCategory.CREATIVITY,
        SdkWellbeingCategory.MOVEMENT_RESET to WellbeingCategory.MOVEMENT_RESET,
        SdkWellbeingCategory.REST_AND_RESET to WellbeingCategory.REST_AND_RESET,
        SdkWellbeingCategory.OUTDOOR_OR_OFFSCREEN to WellbeingCategory.OUTDOOR_OR_OFFSCREEN,
        SdkWellbeingCategory.PLANNING_AND_ORGANIZATION to WellbeingCategory.PLANNING_AND_ORGANIZATION,
        SdkWellbeingCategory.CUSTOM to WellbeingCategory.PARENT_CUSTOM_OTHER,
    )

    private val ANDROID_TO_SDK: Map<WellbeingCategory, SdkWellbeingCategory> =
        SDK_TO_ANDROID.entries.associate { (k, v) -> v to k }

    /** Always total -- every [SdkWellbeingCategory] has exactly one Android home. */
    fun toAndroid(category: SdkWellbeingCategory): WellbeingCategory =
        SDK_TO_ANDROID.getValue(category)

    /** Null only for [WellbeingCategory.CHILD_SELECTED_FAVORITES], the one Android category with
     * no SDK equivalent (it is never a real authored category -- see class doc). */
    fun toSdkOrNull(category: WellbeingCategory): SdkWellbeingCategory? = ANDROID_TO_SDK[category]
}
