package org.pca.app.feature.wellbeing.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import org.pca.app.R
import org.pca.app.feature.wellbeing.model.NudgeFeedbackType
import org.pca.app.feature.wellbeing.model.WellbeingSuggestion

/**
 * Renders IN_APP_CARD / NEXT_UNLOCK_CARD / BREAK_SHIELD_CARD content (PCA-WELL-012). Every
 * suggestion is a full-size, clearly labeled `Button` (large touch target, standard TalkBack
 * semantics, works at any system font scale since it is plain `Text`, no color/animation/sound/
 * haptic-only signaling -- PCA-WELL-021 accessibility requirement). Dismiss is always available
 * and never penalized (PCA-WELL-002): there is no required action to close this card.
 */
@Composable
fun WellbeingCardScreen(
    state: WellbeingCardViewState,
    onSuggestionFeedback: (WellbeingSuggestion, NudgeFeedbackType) -> Unit,
    onDismiss: () -> Unit,
) {
    Column(modifier = Modifier.padding(16.dp)) {
        Text(text = stringResource(R.string.wellbeing_card_title), style = MaterialTheme.typography.titleMedium)
        for ((suggestion, text) in state.suggestions) {
            Column(modifier = Modifier.padding(vertical = 8.dp).semantics { contentDescription = text }) {
                Text(text = text, style = MaterialTheme.typography.bodyLarge)
                // WELL-2: a hazard-adjacent suggestion is only ever delivered on this foreground,
                // interactive surface in the first place (NudgeSelectionEngine's delivery-safety
                // rule) -- this visible+accessible indicator is the required, non-color/icon-only
                // supervision cue for it. Plain Text (not a color/icon/animation) so it survives
                // TalkBack, high-contrast, and print/screenshot review equally.
                if (suggestion.requiresAdultSupervision) {
                    val supervisionText = stringResource(R.string.wellbeing_card_requires_adult_supervision)
                    // Plain `Text` automatically exposes its string as an accessible
                    // (TalkBack-readable) semantics node -- no separate contentDescription is
                    // needed for this to be screen-reader visible, and this text is never
                    // conveyed by color/icon/animation alone.
                    Text(text = supervisionText, style = MaterialTheme.typography.bodyMedium)
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(onClick = { onSuggestionFeedback(suggestion, NudgeFeedbackType.HELPFUL) }) {
                        Text(stringResource(R.string.wellbeing_card_helpful))
                    }
                    if (state.canMarkNotHelpful) {
                        Button(onClick = { onSuggestionFeedback(suggestion, NudgeFeedbackType.NOT_FOR_ME) }) {
                            Text(stringResource(R.string.wellbeing_card_not_for_me))
                        }
                    }
                    Button(onClick = { onSuggestionFeedback(suggestion, NudgeFeedbackType.DONE_SELF_REPORTED) }) {
                        Text(stringResource(R.string.wellbeing_card_done))
                    }
                    if (state.canSnooze) {
                        Button(onClick = { onSuggestionFeedback(suggestion, NudgeFeedbackType.REMIND_LATER) }) {
                            Text(stringResource(R.string.wellbeing_card_remind_later))
                        }
                    }
                }
            }
        }
        Button(onClick = onDismiss) { Text(stringResource(R.string.wellbeing_card_dismiss)) }
    }
}
