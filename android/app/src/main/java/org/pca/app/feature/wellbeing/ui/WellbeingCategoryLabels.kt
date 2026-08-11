package org.pca.app.feature.wellbeing.ui

import org.pca.app.R
import org.pca.app.feature.wellbeing.model.WellbeingCategory

/** Maps each [WellbeingCategory] to its display string resource -- PCA-WELL-021: no hardcoded
 * category labels anywhere in the UI. */
fun WellbeingCategory.labelRes(): Int = when (this) {
    WellbeingCategory.SKILLS_AND_LEARNING -> R.string.wellbeing_category_skills_and_learning
    WellbeingCategory.READING -> R.string.wellbeing_category_reading
    WellbeingCategory.FAITH_POSITIVE -> R.string.wellbeing_category_faith_positive
    WellbeingCategory.GRATITUDE -> R.string.wellbeing_category_gratitude
    WellbeingCategory.GOOD_DEED -> R.string.wellbeing_category_good_deed
    WellbeingCategory.FAMILY_HELP -> R.string.wellbeing_category_family_help
    WellbeingCategory.HOME_RESPONSIBILITY -> R.string.wellbeing_category_home_responsibility
    WellbeingCategory.CREATIVITY -> R.string.wellbeing_category_creativity
    WellbeingCategory.MOVEMENT_RESET -> R.string.wellbeing_category_movement_reset
    WellbeingCategory.REST_AND_RESET -> R.string.wellbeing_category_rest_and_reset
    WellbeingCategory.OUTDOOR_OR_OFFSCREEN -> R.string.wellbeing_category_outdoor_or_offscreen
    WellbeingCategory.PLANNING_AND_ORGANIZATION -> R.string.wellbeing_category_planning_and_organization
    WellbeingCategory.CHILD_SELECTED_FAVORITES -> R.string.wellbeing_category_child_selected_favorites
}
