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
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import org.pca.app.R
import org.pca.app.feature.wellbeing.model.GameReturnResponse

/**
 * GAME_RETURN_NUDGE (PCA-WELL-010): a soft, three-way, non-blocking prompt. `CONTINUE` is styled
 * identically to the other two options -- never smaller, greyed out, or requiring extra taps --
 * because continuing is never framed as a failure (PCA-WELL-002).
 */
@Composable
fun GameReturnCardScreen(
    state: GameReturnCardViewState,
    onResponse: (GameReturnResponse) -> Unit,
) {
    Column(modifier = Modifier.padding(16.dp)) {
        Text(
            text = stringResource(R.string.wellbeing_game_return_title),
            style = MaterialTheme.typography.titleMedium,
            modifier = Modifier.semantics { heading() },
        )
        Text(text = state.bodyText, style = MaterialTheme.typography.bodyLarge)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = { onResponse(GameReturnResponse.CONTINUE) }) {
                Text(stringResource(R.string.wellbeing_game_return_continue))
            }
            Button(onClick = { onResponse(GameReturnResponse.TRY_AN_ALTERNATIVE) }) {
                Text(stringResource(R.string.wellbeing_game_return_try_alternative))
            }
            Button(onClick = { onResponse(GameReturnResponse.REMIND_ME_LATER) }) {
                Text(stringResource(R.string.wellbeing_game_return_remind_later))
            }
        }
    }
}
