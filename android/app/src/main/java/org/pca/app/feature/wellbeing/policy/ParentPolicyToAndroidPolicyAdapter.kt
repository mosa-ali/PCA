package org.pca.app.feature.wellbeing.policy

import kotlin.time.Duration.Companion.minutes
import org.pca.app.feature.wellbeing.catalogue.WellbeingContentCatalogue
import org.pca.app.feature.wellbeing.model.WellbeingNudgePolicy
import org.pca.app.feature.wellbeing.model.WellbeingSuggestion

/**
 * Top-level orchestrator: maps an accepted [ParentWellbeingPolicyV1] onto the *existing* Android
 * runtime policy/catalogue types so [org.pca.app.feature.wellbeing.engine.NudgeSelectionEngine]
 * consumes them unchanged (item 3). Two outputs, matching the engine's own two-input shape
 * (`policy` + `catalogueEntries`/`customApprovedEntries`):
 *
 * 1. [curatedEntriesFor] -- which of the existing, bundled, offline
 *    [WellbeingContentCatalogue] entries stay enabled, per the parent's
 *    `selectedCuratedSuggestionIds` (doc 36 section 6.2). Curated *content* itself is never
 *    duplicated into the parent policy document -- only suggestionId enable/disable state is.
 * 2. [derivePolicy] -- folds the parent policy's `enabled` flag and a conservative, policy-wide
 *    frequency envelope (see below) onto the locally-stored
 *    [WellbeingNudgePolicy] (loaded via the existing `WellbeingPolicyStore`, untouched by this
 *    adapter -- the adapter receives it as `base` and returns a copy).
 *
 * Custom-message-derived [WellbeingSuggestion]s are intentionally NOT produced here: they are
 * trigger/schedule/locale-dependent per dispatch, so they come from
 * [ParentCustomMessagePool.eligibleFor] at the point of each
 * [org.pca.app.feature.wellbeing.engine.WellbeingTriggerDispatcher] call instead.
 *
 * ### Frequency folding (item FREQUENCY, doc 38)
 * The SDK's `DeliveryPolicy` (`minimumIntervalMinutes`/`maximumPerDay`/`repeatCooldownMinutes`) is
 * *per custom message*; Android's [WellbeingNudgePolicy] anti-spam knobs
 * (`minimumInterval`/`maximumDailyNudges`/`sameSuggestionRepeatCooldown`, PCA-WELL-008) are
 * *policy-wide* -- there is no per-suggestion equivalent in the existing engine, and this adapter
 * does not add one (item 3: consumed unchanged). Rather than picking one arbitrary message's
 * numbers, every enabled/non-archived custom message's `DeliveryPolicy` is folded in using the
 * MOST CONSERVATIVE value across all of them (safety-first: a custom message's frequency intent
 * is never *exceeded*, only ever matched or made stricter):
 * - `minimumInterval`  = max(existing base value, every message's `minimumIntervalMinutes`)
 * - `maximumDailyNudges` = min(existing base value, every message's `maximumPerDay`)
 * - `sameSuggestionRepeatCooldown` = max(existing base value, every message's `repeatCooldownMinutes`)
 *
 * The SDK's own product-safe floors/ceiling (`parent-sdk/wellbeing-control/src/bounds.ts`:
 * `MINIMUM_INTERVAL_MINUTES_FLOOR=5`, `MAXIMUM_PER_DAY_CEILING=12`, `REPEAT_COOLDOWN_MINUTES_FLOOR=15`)
 * were already enforced client-side before this policy was accepted (doc 36 section 8); this
 * adapter does not re-validate them, only combines already-valid numbers conservatively.
 */
object ParentPolicyToAndroidPolicyAdapter {

    fun curatedEntriesFor(parentPolicy: ParentWellbeingPolicyV1): List<WellbeingSuggestion> {
        val disabled = parentPolicy.selectedCuratedSuggestionIds
            .filter { !it.enabled }
            .map { it.suggestionId }
            .toSet()
        return WellbeingContentCatalogue.entries.filter { it.suggestionId !in disabled }
    }

    fun derivePolicy(base: WellbeingNudgePolicy, parentPolicy: ParentWellbeingPolicyV1): WellbeingNudgePolicy {
        val activeMessages = parentPolicy.customMessages.filter { it.enabled && !it.isArchived }
        if (activeMessages.isEmpty()) {
            return base.copy(enabled = parentPolicy.enabled)
        }

        val minInterval = activeMessages.maxOf { it.delivery.minimumIntervalMinutes }
        val maxPerDay = activeMessages.minOf { it.delivery.maximumPerDay }
        val repeatCooldown = activeMessages.maxOf { it.delivery.repeatCooldownMinutes }

        return base.copy(
            enabled = parentPolicy.enabled,
            minimumInterval = maxOf(base.minimumInterval.inWholeMinutes, minInterval.toLong()).minutes,
            maximumDailyNudges = minOf(base.maximumDailyNudges, maxPerDay),
            sameSuggestionRepeatCooldown = maxOf(base.sameSuggestionRepeatCooldown.inWholeMinutes, repeatCooldown.toLong()).minutes,
        )
    }
}
