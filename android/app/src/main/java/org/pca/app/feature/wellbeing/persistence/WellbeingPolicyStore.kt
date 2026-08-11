package org.pca.app.feature.wellbeing.persistence

import kotlin.time.Duration.Companion.nanoseconds
import org.pca.app.feature.wellbeing.model.DurationBucket
import org.pca.app.feature.wellbeing.model.WellbeingCategory
import org.pca.app.feature.wellbeing.model.WellbeingNudgePolicy
import org.pca.app.foundation.PersistentStateStore

/**
 * Durable local storage for the parent-owned [WellbeingNudgePolicy] (PCA-WELL-007). Local-only by
 * default; syncing a policy across the family's devices is expected to ride the existing Family
 * Envelope / FTS transport (doc 09, doc 11) at the Coordinator integration layer, not a new one.
 */
class WellbeingPolicyStore(
    private val store: PersistentStateStore,
    private val key: String = KEY,
) {
    fun save(policy: WellbeingNudgePolicy) {
        store.putString(key, encode(policy))
    }

    fun load(): WellbeingNudgePolicy = store.getString(key)?.let { decode(it) } ?: WellbeingNudgePolicy()

    fun clear() {
        store.remove(key)
    }

    internal fun encode(p: WellbeingNudgePolicy): String {
        val fields = listOf(
            p.enabled.toString(),
            p.eligibleApps.joinToString(ITEM_SEP),
            p.enabledCategories.joinToString(ITEM_SEP) { it.name },
            p.faithContentEnabled.toString(),
            p.lockScreenSuggestionsEnabled.toString(),
            p.periodicNudgesEnabled.toString(),
            p.gameReturnNudgeEnabled.toString(),
            p.breakSuggestionsEnabled.toString(),
            p.quietHoursStartMinuteOfDay?.toString() ?: NULL,
            p.quietHoursEndMinuteOfDay?.toString() ?: NULL,
            p.minimumInterval.inWholeNanoseconds.toString(),
            p.maximumDailyNudges.toString(),
            p.sameSuggestionRepeatCooldown.inWholeNanoseconds.toString(),
            p.gameReturnWindow.inWholeNanoseconds.toString(),
            p.durationPreferences.joinToString(ITEM_SEP) { it.name },
            p.childCanSnooze.toString(),
            p.childCanMarkNotHelpful.toString(),
            p.parentCanAddCustomSuggestions.toString(),
            p.privacyMode.toString(),
        )
        return fields.joinToString(FIELD_SEP)
    }

    internal fun decode(raw: String): WellbeingNudgePolicy? {
        val parts = raw.split(FIELD_SEP, limit = FIELD_COUNT)
        if (parts.size != FIELD_COUNT) return null
        return try {
            WellbeingNudgePolicy(
                enabled = parts[0].toBoolean(),
                eligibleApps = parts[1].split(ITEM_SEP).filter { it.isNotEmpty() }.toSet(),
                enabledCategories = parts[2].split(ITEM_SEP).filter { it.isNotEmpty() }
                    .map { WellbeingCategory.valueOf(it) }.toSet(),
                faithContentEnabled = parts[3].toBoolean(),
                lockScreenSuggestionsEnabled = parts[4].toBoolean(),
                periodicNudgesEnabled = parts[5].toBoolean(),
                gameReturnNudgeEnabled = parts[6].toBoolean(),
                breakSuggestionsEnabled = parts[7].toBoolean(),
                quietHoursStartMinuteOfDay = parts[8].takeIf { it != NULL }?.toInt(),
                quietHoursEndMinuteOfDay = parts[9].takeIf { it != NULL }?.toInt(),
                minimumInterval = parts[10].toLong().nanoseconds,
                maximumDailyNudges = parts[11].toInt(),
                sameSuggestionRepeatCooldown = parts[12].toLong().nanoseconds,
                gameReturnWindow = parts[13].toLong().nanoseconds,
                durationPreferences = parts[14].split(ITEM_SEP).filter { it.isNotEmpty() }
                    .map { DurationBucket.valueOf(it) }.toSet(),
                childCanSnooze = parts[15].toBoolean(),
                childCanMarkNotHelpful = parts[16].toBoolean(),
                parentCanAddCustomSuggestions = parts[17].toBoolean(),
                privacyMode = parts[18].toBoolean(),
            )
        } catch (_: IllegalArgumentException) {
            null
        }
    }

    private companion object {
        const val KEY = "wellbeing_policy_v1"
        const val FIELD_SEP = "|"
        const val ITEM_SEP = ","
        const val FIELD_COUNT = 19
        const val NULL = "NULL"
    }
}
