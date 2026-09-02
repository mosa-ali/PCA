package org.pca.app.feature.wellbeing.ui

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import org.pca.app.PcaApplication
import org.pca.app.accessibility.PcaAccessibilityContent
import org.pca.app.feature.wellbeing.catalogue.WellbeingContentCatalogue
import org.pca.app.feature.wellbeing.delivery.WellbeingMessageResolver
import org.pca.app.feature.wellbeing.model.WellbeingNudgeDelivery

/**
 * PCA-WELL-012 closure: the real host Activity for [WellbeingCardScreen] -- the `IN_APP_CARD` /
 * `NEXT_UNLOCK_CARD` / `BREAK_SHIELD_CARD` surfaces `WellbeingNotificationDelivery` deliberately
 * does not render (that class is scoped only to `STANDARD_NOTIFICATION`/
 * `LOCK_SCREEN_NOTIFICATION_BEST_EFFORT`; every card channel previously returned
 * `SUPPRESSED_CAPABILITY_UNAVAILABLE` with no rendering surface at all). Mirrors
 * [org.pca.app.feature.breakshield.ui.BreakShieldActivity]/
 * [org.pca.app.feature.eyedistance.ui.EyeRestShieldActivity]'s exact Activity-hosting-a-Composable
 * pattern (this app has no shared Compose `NavHost` anywhere under `src/main`, so a dedicated,
 * narrowly-scoped Activity is this codebase's existing pattern for a new reachable screen).
 *
 * Content is read directly off `(application as PcaApplication).graph.pendingWellbeingCardStore`
 * -- the same "read live state off the graph, not an Intent payload" pattern the two shield
 * Activities use for their own (continuous, engine-derived) state, adapted here for a one-shot
 * nudge-selection event: only [org.pca.app.feature.wellbeing.model.WellbeingSuggestion.suggestionId]s
 * are persisted (see [org.pca.app.feature.wellbeing.persistence.PendingWellbeingCardStore]'s own
 * doc comment), resolved back to full suggestions via [WellbeingContentCatalogue] here, exactly as
 * every other reader of a persisted suggestion reference in this feature already does.
 *
 * INTEGRATION CLOSURE: registered in `AndroidManifest.xml` (not exported, no intent-filter, same
 * pattern as the two shield Activities), and
 * `org.pca.app.runtime.graph.PcaAppGraph.launchWellbeingCardActivity()` fires the actual
 * `startActivity(Intent(context, WellbeingCardActivity::class.java).addFlags(FLAG_ACTIVITY_NEW_TASK))`
 * call -- immediately from `WellbeingCardDelivery` for `IN_APP_CARD`/`BREAK_SHIELD_CARD`, and from
 * the graph's own next-unlock observer once a queued `NEXT_UNLOCK_CARD` is finally due.
 *
 * [onSuggestionFeedback] closes two pre-existing zero-production-caller gaps at once via
 * `PcaAppGraph.recordWellbeingFeedback`: it appends to
 * [org.pca.app.feature.wellbeing.policy.WellbeingFeedbackLogStore] (previously constructed nowhere
 * in production) AND runs
 * [org.pca.app.feature.wellbeing.engine.NudgeSelectionEngine.applyFeedback] into the durable
 * `NudgeRateState` (also previously never called in production) so a `NOT_FOR_ME` really suppresses
 * that suggestion for its cooldown window, not merely gets logged. See that method's own doc
 * comment for the full reasoning.
 */
class WellbeingCardActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val graph = (application as PcaApplication).graph
        val pending = graph.pendingWellbeingCardStore.load()
        val policy = graph.wellbeingPolicyStore.load()
        val resolver = WellbeingMessageResolver(this)

        val suggestions = pending?.suggestionIds.orEmpty()
            .mapNotNull { id -> WellbeingContentCatalogue.entries.find { it.suggestionId == id } }

        val state = WellbeingCardViewState(
            suggestions = suggestions.map { it to resolver.resolve(it) },
            canSnooze = policy.childCanSnooze,
            canMarkNotHelpful = policy.childCanMarkNotHelpful,
        )

        setContent {
            PcaAccessibilityContent {
                WellbeingCardScreen(
                    state = state,
                    onSuggestionFeedback = { suggestion, feedback ->
                        graph.recordWellbeingFeedback(suggestion.suggestionId, feedback)
                    },
                    onDismiss = {
                        // Only a NEXT_UNLOCK_CARD entry was ever meant to persist beyond this
                        // single showing (WELL-12: it survives specifically until the next real
                        // unlock) -- clearing it here, gated on that being what this card actually
                        // was, matches PCA-WELL-1's own dismiss-is-never-penalized contract without
                        // silently discarding an IN_APP_CARD/BREAK_SHIELD_CARD entry's record for
                        // reasons unrelated to the child's own dismissal.
                        if (pending?.delivery == WellbeingNudgeDelivery.NEXT_UNLOCK_CARD) {
                            graph.pendingWellbeingCardStore.clear()
                        }
                        finish()
                    },
                )
            }
        }
    }
}
