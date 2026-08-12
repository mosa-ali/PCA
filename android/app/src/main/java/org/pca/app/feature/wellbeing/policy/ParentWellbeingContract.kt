package org.pca.app.feature.wellbeing.policy

/**
 * Kotlin mirror of `parent-sdk/wellbeing-control/src/types.ts` (`WellbeingMessageControlV1`,
 * doc 36 "Parent-Controlled Wellbeing Message Policy"). This is a logical-domain-object mirror
 * only, matching how `policyEditorService.ts` consumes the TypeScript contract: it assumes the
 * payload has already been decrypted/parsed out of the family envelope by whatever transport
 * lane owns that (doc 36 section 15's non-goals explicitly exclude wire serialization and crypto
 * from this contract, and the `android/.../runtime/` subtree (the transport/crypto lane) is out of
 * scope for this worktree). Nothing here selects a signature suite or wire format.
 *
 * These types deliberately do NOT become a second runtime policy authority: every one of them is
 * immediately and exclusively consumed by [ParentPolicyToAndroidPolicyAdapter] /
 * [ParentCustomMessageAdapter], which translate into the pre-existing Android runtime types
 * ([org.pca.app.feature.wellbeing.model.WellbeingNudgePolicy],
 * [org.pca.app.feature.wellbeing.model.WellbeingSuggestion]) that
 * [org.pca.app.feature.wellbeing.engine.NudgeSelectionEngine] already consumes unchanged.
 */

/** Mirrors `WellbeingCategory` in types.ts -- the parent-authoring taxonomy is a strict subset of
 * the Android runtime's [org.pca.app.feature.wellbeing.model.WellbeingCategory] plus one generic
 * catch-all (`CUSTOM`) that has no Android equivalent (see [CategoryMapping], doc 38). */
enum class SdkWellbeingCategory {
    SKILLS_AND_LEARNING, READING, FAITH_POSITIVE, GRATITUDE, GOOD_DEED, FAMILY_HELP,
    HOME_RESPONSIBILITY, CREATIVITY, MOVEMENT_RESET, REST_AND_RESET, OUTDOOR_OR_OFFSCREEN,
    PLANNING_AND_ORGANIZATION, CUSTOM,
}

/** Mirrors `WellbeingTrigger` in types.ts (see [TriggerMapping], doc 38). */
enum class SdkWellbeingTrigger {
    PERIODIC, AFTER_UNLOCK, RAPID_GAME_RETURN, BREAK_STARTED, BREAK_ACTIVE, BREAK_COMPLETED,
    LONG_SESSION_ENDED, SCHEDULED_TIME, CHILD_REQUESTED_IDEA,
}

enum class SdkTargetMode { ONE_CHILD, MULTIPLE_CHILDREN, ALL_CHILDREN }

data class SdkTargetScope(
    val mode: SdkTargetMode,
    val childProfileIds: List<String> = emptyList(),
) {
    /** Whether this scope reaches [childProfileId]. `ALL_CHILDREN` always resolves true -- doc 36
     * section 4: it is resolved to the family's current child set at delivery time, never baked
     * into the policy document, so on-device it always includes "this child". */
    fun reaches(childProfileId: String): Boolean = when (mode) {
        SdkTargetMode.ALL_CHILDREN -> true
        SdkTargetMode.ONE_CHILD, SdkTargetMode.MULTIPLE_CHILDREN -> childProfileId in childProfileIds
    }
}

data class SdkLanguageText(val title: String, val body: String)

data class SdkTimeWindow(val startMinute: Int, val endMinute: Int)

data class SdkScheduleWindow(
    val startDate: String? = null,
    val endDate: String? = null,
    val daysOfWeek: Set<String> = emptySet(),
    val timeWindows: List<SdkTimeWindow> = emptyList(),
    val timezoneId: String? = null,
)

data class SdkDeliveryPolicy(
    val triggers: Set<SdkWellbeingTrigger>,
    val minimumIntervalMinutes: Int,
    val maximumPerDay: Int,
    val repeatCooldownMinutes: Int,
    val lockScreenAllowed: Boolean,
    val dismissible: Boolean = true,
    val snoozable: Boolean = true,
    val requiresAdultSupervision: Boolean = false,
)

data class SdkCustomWellbeingMessage(
    val messageId: String,
    val enabled: Boolean,
    val category: SdkWellbeingCategory,
    val languageTexts: Map<String, SdkLanguageText>,
    val schedule: SdkScheduleWindow,
    val delivery: SdkDeliveryPolicy,
    val target: SdkTargetScope,
    val archivedAt: String? = null,
) {
    val isArchived: Boolean get() = archivedAt != null
}

data class SdkCuratedSuggestionSelection(val suggestionId: String, val enabled: Boolean)

/** Mirrors `WellbeingMessageControlV1`. */
data class ParentWellbeingPolicyV1(
    val policyId: String,
    val policyRevision: Int,
    val familyScopeRef: String,
    val targets: SdkTargetScope,
    val enabled: Boolean,
    val selectedCuratedSuggestionIds: List<SdkCuratedSuggestionSelection> = emptyList(),
    val customMessages: List<SdkCustomWellbeingMessage> = emptyList(),
    val createdAt: String = "",
    val updatedAt: String = "",
)
