package org.pca.app.feature.wellbeing.persistence

import org.pca.app.feature.wellbeing.model.NudgeRateState
import org.pca.app.foundation.PersistentStateStore

/**
 * Durable local storage for [NudgeRateState] (PCA-WELL-011, PCA-WELL-019). Only aggregate
 * counters/monotonic instants/suggestion IDs are stored -- no activity history, screen content,
 * or message data. Follows the same delimited-encoding, fail-safe-decode pattern as PCA-3's
 * `PersistentScreenTimeSnapshotStore` so a corrupt/future-version value degrades to "no state"
 * rather than crashing (PCA-WELL-011 reboot handling).
 */
class WellbeingRateStateStore(
    private val store: PersistentStateStore,
    private val key: String = KEY,
) {
    fun save(state: NudgeRateState) {
        store.putString(key, encode(state))
    }

    fun load(): NudgeRateState? = store.getString(key)?.let { decode(it) }

    fun clear() {
        store.remove(key)
    }

    internal fun encode(s: NudgeRateState): String {
        val fields = listOf(
            s.lastEligibleAppToken ?: NULL,
            s.lastEligibleExitMonotonicNanos?.toString() ?: NULL,
            s.lastScreenLockMonotonicNanos?.toString() ?: NULL,
            s.lastUnlockMonotonicNanos?.toString() ?: NULL,
            s.lastNudgeMonotonicNanos?.toString() ?: NULL,
            s.dayWindowAnchorMonotonicNanos?.toString() ?: NULL,
            s.dailyNudgeCount.toString(),
            s.recentSuggestionIds.joinToString(ITEM_SEP),
            s.lastDeliveredAtBySuggestionId.entries.joinToString(ITEM_SEP) { "${it.key}$KV_SEP${it.value}" },
            s.notForMeUntilBySuggestionId.entries.joinToString(ITEM_SEP) { "${it.key}$KV_SEP${it.value}" },
            s.rapidReentryCount.toString(),
            s.lastReflectionMonotonicNanos?.toString() ?: NULL,
            s.lastBootGenerationToken ?: NULL,
        )
        return fields.joinToString(FIELD_SEP)
    }

    internal fun decode(raw: String): NudgeRateState? {
        val parts = raw.split(FIELD_SEP, limit = FIELD_COUNT)
        if (parts.size != FIELD_COUNT) return null
        return try {
            NudgeRateState(
                lastEligibleAppToken = parts[0].takeIf { it != NULL },
                lastEligibleExitMonotonicNanos = parts[1].takeIf { it != NULL }?.toLong(),
                lastScreenLockMonotonicNanos = parts[2].takeIf { it != NULL }?.toLong(),
                lastUnlockMonotonicNanos = parts[3].takeIf { it != NULL }?.toLong(),
                lastNudgeMonotonicNanos = parts[4].takeIf { it != NULL }?.toLong(),
                dayWindowAnchorMonotonicNanos = parts[5].takeIf { it != NULL }?.toLong(),
                dailyNudgeCount = parts[6].toInt(),
                recentSuggestionIds = parts[7].split(ITEM_SEP).filter { it.isNotEmpty() },
                lastDeliveredAtBySuggestionId = parseMap(parts[8]),
                notForMeUntilBySuggestionId = parseMap(parts[9]),
                rapidReentryCount = parts[10].toInt(),
                lastReflectionMonotonicNanos = parts[11].takeIf { it != NULL }?.toLong(),
                lastBootGenerationToken = parts[12].takeIf { it != NULL },
            )
        } catch (_: IllegalArgumentException) {
            null
        }
    }

    private fun parseMap(raw: String): Map<String, Long> =
        raw.split(ITEM_SEP)
            .filter { it.isNotEmpty() }
            .mapNotNull { entry ->
                val idx = entry.lastIndexOf(KV_SEP)
                if (idx <= 0) return@mapNotNull null
                val k = entry.substring(0, idx)
                val v = entry.substring(idx + KV_SEP.length).toLongOrNull() ?: return@mapNotNull null
                k to v
            }
            .toMap()

    private companion object {
        const val KEY = "wellbeing_rate_state_v1"
        const val FIELD_SEP = "|"
        const val ITEM_SEP = ","
        const val KV_SEP = "="
        const val FIELD_COUNT = 13
        const val NULL = "NULL"
    }
}
