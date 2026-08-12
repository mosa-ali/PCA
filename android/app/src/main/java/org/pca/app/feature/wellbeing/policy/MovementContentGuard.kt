package org.pca.app.feature.wellbeing.policy

/**
 * Movement-safety content guard (item 9, PCA-WELL-025) for parent-authored custom messages in the
 * [org.pca.app.feature.wellbeing.model.WellbeingCategory.MOVEMENT_RESET] category flowing through
 * [ParentCustomMessageAdapter]. Mirrors the curated catalogue's existing tone contract
 * (`WellbeingContentCatalogueTest`'s "movement-reset content never mentions calories or weight")
 * and [org.pca.app.feature.wellbeing.security.CustomSuggestionSanitizer]'s mechanical, deterministic
 * style: a keyword-pattern safety floor only, not a content-appropriateness classifier. Movement
 * suggestions must stay optional/short/non-punitive -- no calories, weight, body-shape goals, or
 * punitive/over-exercise ("make up for screen time") framing.
 */
object MovementContentGuard {

    sealed interface Result {
        data object Accepted : Result
        data class Rejected(val reason: String) : Result
    }

    private val CALORIE_WEIGHT_PATTERNS = listOf(
        "calorie", "calories", "kcal", "lose weight", "weight loss", "body shape", "burn off",
        "burn calories", "bmi", "kilograms", "pounds lost",
    )

    private val PUNITIVE_PATTERNS = listOf(
        "make up for", "earn your", "punish", "penalty", "you must exercise", "no screen until you",
        "work off", "pay for the time",
    )

    fun check(title: String, body: String): Result {
        val text = "$title $body".lowercase()
        CALORIE_WEIGHT_PATTERNS.firstOrNull { text.contains(it) }?.let {
            return Result.Rejected("calorie_or_weight_language:$it")
        }
        PUNITIVE_PATTERNS.firstOrNull { text.contains(it) }?.let {
            return Result.Rejected("punitive_language:$it")
        }
        return Result.Accepted
    }
}
