package org.pca.app.feature.wellbeing.policy

import org.pca.app.feature.wellbeing.model.DurationBucket
import org.pca.app.feature.wellbeing.model.NudgeTrigger
import org.pca.app.feature.wellbeing.model.WellbeingCategory
import org.pca.app.feature.wellbeing.model.WellbeingSuggestion
import org.pca.app.feature.wellbeing.security.CustomSuggestionSanitizer

/**
 * Converts parent-authored [SdkCustomWellbeingMessage]s (already decrypted/parsed, already
 * revision-accepted -- see [ParentPolicyRevisionGuard]) into the existing Android runtime's
 * [WellbeingSuggestion] type, so [org.pca.app.feature.wellbeing.engine.NudgeSelectionEngine]
 * consumes them completely unchanged (item 3 of the PCA-RUNTIME-WELL-1 task spec). This is the
 * only place parent-authored custom-message fields are mapped; see doc 38 for the full field
 * table.
 *
 * Field mapping summary (doc 38 has the authoritative table):
 * - `category` -> [CategoryMapping.toAndroid].
 * - `languageTexts` -> exactly the variant matching the device's *active* locale is used; if that
 *   locale has no parent-authored variant, the message contributes nothing for this device right
 *   now (item 7: never auto-translated, never silently falls back to a different language).
 * - `delivery.requiresAdultSupervision` -> [WellbeingSuggestion.requiresAdultSupervision], which
 *   [org.pca.app.feature.wellbeing.engine.NudgeSelectionEngine] already hard-gates off every
 *   delivery surface except `IN_APP_CARD` (item 8) -- unchanged engine behavior.
 * - `delivery.lockScreenAllowed` -> [WellbeingSuggestion.lockScreenSafe], additionally forced
 *   `false` whenever `requiresAdultSupervision` is true (defense-in-depth double gate, matching
 *   doc 36 section 9's own "lockScreenAllowed MUST be false" rule -- re-enforced independently
 *   here per doc 36 PCA-WELLCTRL-071, never trusted from the incoming payload alone).
 * - `delivery.triggers`/schedule/target/archived/enabled -> NOT baked into the produced
 *   [WellbeingSuggestion] (which has no such fields); instead they gate *whether* a suggestion is
 *   produced at all for a given (trigger, wall-clock, child) combination -- see
 *   [ParentCustomMessagePool.eligibleFor]. `delivery.minimumIntervalMinutes` /`maximumPerDay`/
 *   `repeatCooldownMinutes` are policy-wide, not per-suggestion, on the Android side; see
 *   [ParentPolicyToAndroidPolicyAdapter] for how they are conservatively folded into
 *   [org.pca.app.feature.wellbeing.model.WellbeingNudgePolicy].
 * - duration bucket: the SDK contract has no duration concept at all. This adapter defaults every
 *   custom message to [DurationBucket.SHORT_2_5_MIN] -- the safest, least time-demanding bucket --
 *   and documents this as a deliberate one-way default, not a lossy round-trip (doc 38).
 */
object ParentCustomMessageAdapter {

    private val DEFAULT_DURATION = DurationBucket.SHORT_2_5_MIN

    sealed interface MappingResult {
        data class Produced(val suggestion: WellbeingSuggestion) : MappingResult
        data object NotEligibleNow : MappingResult
        data class Rejected(val reason: String) : MappingResult
    }

    fun map(
        message: SdkCustomWellbeingMessage,
        childProfileId: String,
        deviceLocale: String,
        now: ScheduleWindowEvaluator.WallClockSnapshot,
    ): MappingResult {
        if (!message.enabled || message.isArchived) return MappingResult.NotEligibleNow
        if (!message.target.reaches(childProfileId)) return MappingResult.NotEligibleNow
        if (!ScheduleWindowEvaluator.isActiveNow(message.schedule, now)) return MappingResult.NotEligibleNow

        // Item 7: no auto-translate, no fallback to a different language's text.
        val languageText = message.languageTexts[deviceLocale] ?: return MappingResult.NotEligibleNow

        val sanitizedTitle = sanitizeOrNull(languageText.title) ?: return MappingResult.Rejected("title_failed_safety_floor")
        val sanitizedBody = sanitizeOrNull(languageText.body) ?: return MappingResult.Rejected("body_failed_safety_floor")

        val androidCategory = CategoryMapping.toAndroid(message.category)

        if (androidCategory == WellbeingCategory.MOVEMENT_RESET) {
            val guard = MovementContentGuard.check(sanitizedTitle, sanitizedBody)
            if (guard is MovementContentGuard.Result.Rejected) {
                return MappingResult.Rejected("movement_guard:${guard.reason}")
            }
        }

        val requiresAdultSupervision = message.delivery.requiresAdultSupervision
        // Defense-in-depth: never lock-screen-safe when adult supervision is required, regardless
        // of what the incoming payload's lockScreenAllowed claims (doc 36 PCA-WELLCTRL-071).
        val lockScreenSafe = message.delivery.lockScreenAllowed && !requiresAdultSupervision

        val suggestion = WellbeingSuggestion(
            suggestionId = stableSuggestionId(message.messageId, deviceLocale),
            messageId = "custom_raw:$sanitizedTitle: $sanitizedBody",
            category = androidCategory,
            duration = DEFAULT_DURATION,
            lockScreenSafe = lockScreenSafe,
            requiresAdultSupervision = requiresAdultSupervision,
            enabledByDefault = true,
            version = 1,
            isCustom = true,
            languageTag = deviceLocale,
        )
        return MappingResult.Produced(suggestion)
    }

    /** Deterministic and stable across app restarts/re-syncs (unlike
     * [org.pca.app.feature.wellbeing.persistence.CustomSuggestionStore]'s random UUID) so rate
     * state ([org.pca.app.feature.wellbeing.model.NudgeRateState]'s per-suggestion cooldown/NOT_FOR_ME
     * maps) keyed by `suggestionId` stays meaningful run over run for the same parent-authored
     * message + locale. */
    private fun stableSuggestionId(messageId: String, languageTag: String): String =
        "parent.$messageId.$languageTag"

    private fun sanitizeOrNull(text: String): String? =
        when (val result = CustomSuggestionSanitizer.sanitize(text)) {
            is CustomSuggestionSanitizer.Result.Accepted -> result.sanitizedText
            is CustomSuggestionSanitizer.Result.Rejected -> null
        }
}

/**
 * Per-dispatch pooling: computes the [WellbeingSuggestion]s eligible for a specific
 * [NudgeTrigger] dispatch, so the existing
 * [org.pca.app.feature.wellbeing.engine.WellbeingTriggerDispatcher.dispatch]/
 * [org.pca.app.feature.wellbeing.engine.NudgeSelectionEngine.evaluate] calls receive a plain
 * `customApprovedEntries: List<WellbeingSuggestion>` exactly as they already accept from
 * [org.pca.app.feature.wellbeing.persistence.CustomSuggestionStore.approvedSuggestions] --
 * no engine change required.
 */
object ParentCustomMessagePool {

    fun eligibleFor(
        messages: List<SdkCustomWellbeingMessage>,
        androidTrigger: NudgeTrigger,
        childProfileId: String,
        deviceLocale: String,
        now: ScheduleWindowEvaluator.WallClockSnapshot,
    ): List<WellbeingSuggestion> = messages
        .filter { TriggerMapping.coversAndroidTrigger(it.delivery.triggers, androidTrigger) }
        .mapNotNull { message ->
            val result = ParentCustomMessageAdapter.map(message, childProfileId, deviceLocale, now)
            (result as? ParentCustomMessageAdapter.MappingResult.Produced)?.suggestion
        }
}
