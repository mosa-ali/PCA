package org.pca.app.feature.wellbeing.ui

import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import org.pca.app.R

/**
 * GIVE_ME_AN_IDEA (PCA-WELL-023): a child-facing, fully offline, always-available request for a
 * fresh suggestion. Wired by the caller to `WellbeingTriggerDispatcher.dispatch(CHILD_REQUESTED_IDEA, ...)`,
 * which -- because the trigger is child-initiated -- bypasses quiet hours and the daily/interval
 * rate limits (the child asked; nothing is being pushed at them).
 */
@Composable
fun GiveMeAnIdeaButton(onClick: () -> Unit) {
    Button(onClick = onClick) {
        Text(stringResource(R.string.wellbeing_give_me_an_idea_button))
    }
}
