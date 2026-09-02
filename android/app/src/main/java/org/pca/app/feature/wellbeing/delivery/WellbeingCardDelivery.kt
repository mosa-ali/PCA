package org.pca.app.feature.wellbeing.delivery

import org.pca.app.feature.wellbeing.model.NudgeDeliveryResult
import org.pca.app.feature.wellbeing.model.NudgeDeliveryStatus
import org.pca.app.feature.wellbeing.model.WellbeingNudgeDelivery
import org.pca.app.feature.wellbeing.model.WellbeingSuggestion
import org.pca.app.feature.wellbeing.persistence.PendingWellbeingCard
import org.pca.app.feature.wellbeing.persistence.PendingWellbeingCardStore

/**
 * Delivery adapter for the three card-shaped surfaces [WellbeingNotificationDelivery] deliberately
 * does not handle: `IN_APP_CARD`, `BREAK_SHIELD_CARD`, `NEXT_UNLOCK_CARD` (PCA-WELL-012). Every
 * call first persists the selected suggestions + channel into [pendingCardStore] -- the single
 * source `WellbeingCardActivity` reads its content from on launch, since (like every other
 * Compose-hosting Activity in this app) it reads state off the graph rather than an Intent
 * payload.
 *
 * `IN_APP_CARD`/`BREAK_SHIELD_CARD` are shown right now, so [launchCardActivity] (production:
 * `PcaAppGraph.launchWellbeingCardActivity`, the same "construct an Intent with
 * FLAG_ACTIVITY_NEW_TASK and startActivity" shape as `launchEyeRestShieldActivity`/
 * `launchBreakShieldActivity`) fires synchronously with this call. `NEXT_UNLOCK_CARD` deliberately
 * does NOT launch here -- the trigger that selects this content and the real unlock that finally
 * shows it can be a different process or moment entirely; the caller (`PcaAppGraph`'s own
 * `screenStateObserver` subscription) launches it later, on the next real unlock, reading the same
 * [pendingCardStore] entry this call just wrote.
 */
class WellbeingCardDelivery(
    private val pendingCardStore: PendingWellbeingCardStore,
    private val launchCardActivity: () -> Unit,
) {
    fun deliver(
        delivery: WellbeingNudgeDelivery,
        suggestions: List<WellbeingSuggestion>,
        nowMonotonicNanos: Long,
    ): NudgeDeliveryResult {
        if (delivery != WellbeingNudgeDelivery.IN_APP_CARD &&
            delivery != WellbeingNudgeDelivery.BREAK_SHIELD_CARD &&
            delivery != WellbeingNudgeDelivery.NEXT_UNLOCK_CARD
        ) {
            return NudgeDeliveryResult(
                NudgeDeliveryStatus.SUPPRESSED_CAPABILITY_UNAVAILABLE,
                delivery,
                nowMonotonicNanos,
                suggestions.map { it.suggestionId },
            )
        }

        pendingCardStore.save(
            PendingWellbeingCard(
                delivery = delivery,
                suggestionIds = suggestions.map { it.suggestionId },
                queuedAtMonotonicNanos = nowMonotonicNanos,
            ),
        )

        if (delivery != WellbeingNudgeDelivery.NEXT_UNLOCK_CARD) {
            launchCardActivity()
        }

        // NEXT_UNLOCK_CARD is honestly DELIVERED too, not a separate "queued" status: it WILL be
        // shown, just not synchronously with this call (WELL-12's own channel contract). There is
        // no dedicated queued/pending value in NudgeDeliveryStatus, and inventing a new one is out
        // of scope of closing this gap.
        return NudgeDeliveryResult(
            NudgeDeliveryStatus.DELIVERED,
            delivery,
            nowMonotonicNanos,
            suggestions.map { it.suggestionId },
        )
    }
}
