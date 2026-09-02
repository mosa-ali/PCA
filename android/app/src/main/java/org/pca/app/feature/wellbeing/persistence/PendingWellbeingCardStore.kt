package org.pca.app.feature.wellbeing.persistence

import org.pca.app.feature.wellbeing.model.WellbeingNudgeDelivery
import org.pca.app.foundation.PersistentStateStore

/**
 * A single queued card-shaped nudge (IN_APP_CARD / BREAK_SHIELD_CARD / NEXT_UNLOCK_CARD --
 * PCA-WELL-012) waiting to be rendered by
 * [org.pca.app.feature.wellbeing.ui.WellbeingCardActivity]. Only [suggestionIds] are carried, not
 * full [org.pca.app.feature.wellbeing.model.WellbeingSuggestion] objects -- the same
 * suggestion-ID-as-stable-reference convention [WellbeingRateStateStore] already establishes
 * (`recentSuggestionIds`, `lastDeliveredAtBySuggestionId`); a reader resolves the full suggestion
 * back from [org.pca.app.feature.wellbeing.catalogue.WellbeingContentCatalogue].
 */
data class PendingWellbeingCard(
    val delivery: WellbeingNudgeDelivery,
    val suggestionIds: List<String>,
    val queuedAtMonotonicNanos: Long,
)

/**
 * Durable local storage for a single [PendingWellbeingCard] (PCA-WELL-012). Single-slot, same
 * discipline as [WellbeingPolicyStore]/[WellbeingRateStateStore] (a new [save] simply replaces
 * whatever was pending) -- this feature has never needed a queue of more than one outstanding
 * nudge at a time. Exists specifically for [WellbeingNudgeDelivery.NEXT_UNLOCK_CARD]: the trigger
 * that selects the content and the real unlock that finally shows it can be a different process or
 * moment entirely, so the handoff between them must survive a process death, not just an in-memory
 * hop -- but is also reused (see [org.pca.app.feature.wellbeing.delivery.WellbeingCardDelivery]) as
 * the single mechanism [org.pca.app.feature.wellbeing.ui.WellbeingCardActivity] reads its content
 * from for ALL THREE card channels, since (like every other Compose-hosting Activity in this app)
 * it reads state off the graph rather than an Intent payload, and this feature has no continuous
 * "current card" engine state the way the Break/Eye-Rest shields have a continuous engine mode to
 * derive their view state from -- a nudge selection is inherently a one-shot event. Follows the
 * same delimited-encoding, fail-safe-decode pattern as [WellbeingRateStateStore] so a corrupt/
 * future-version value degrades to "nothing pending" rather than crashing.
 */
class PendingWellbeingCardStore(
    private val store: PersistentStateStore,
    private val key: String = KEY,
) {
    fun save(card: PendingWellbeingCard) {
        store.putString(key, encode(card))
    }

    fun load(): PendingWellbeingCard? = store.getString(key)?.let { decode(it) }

    fun clear() {
        store.remove(key)
    }

    internal fun encode(c: PendingWellbeingCard): String {
        val fields = listOf(
            c.delivery.name,
            c.suggestionIds.joinToString(ITEM_SEP),
            c.queuedAtMonotonicNanos.toString(),
        )
        return fields.joinToString(FIELD_SEP)
    }

    internal fun decode(raw: String): PendingWellbeingCard? {
        val parts = raw.split(FIELD_SEP, limit = FIELD_COUNT)
        if (parts.size != FIELD_COUNT) return null
        return try {
            PendingWellbeingCard(
                delivery = WellbeingNudgeDelivery.valueOf(parts[0]),
                suggestionIds = parts[1].split(ITEM_SEP).filter { it.isNotEmpty() },
                queuedAtMonotonicNanos = parts[2].toLong(),
            )
        } catch (_: IllegalArgumentException) {
            null
        }
    }

    private companion object {
        const val KEY = "wellbeing_pending_card_v1"
        const val FIELD_SEP = "|"
        const val ITEM_SEP = ","
        const val FIELD_COUNT = 3
    }
}
