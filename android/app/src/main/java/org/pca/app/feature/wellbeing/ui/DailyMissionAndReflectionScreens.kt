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
import androidx.compose.ui.unit.dp
import org.pca.app.R
import org.pca.app.feature.wellbeing.model.DailyMissionResponse
import org.pca.app.feature.wellbeing.model.ReflectionResponse

/** DAILY_POSITIVE_MISSION (PCA-WELL-022): one per day, DONE/SKIP/NEW_IDEA, never punished, never
 * an automatic screen-time reward -- `onResponse(DONE)` only updates a private local counter. */
@Composable
fun DailyMissionCardScreen(
    state: DailyMissionCardViewState,
    onResponse: (DailyMissionResponse) -> Unit,
) {
    if (state.missionText == null) return
    Column(modifier = Modifier.padding(16.dp)) {
        Text(text = stringResource(R.string.wellbeing_daily_mission_title), style = MaterialTheme.typography.titleMedium)
        Text(text = state.missionText, style = MaterialTheme.typography.bodyLarge)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = { onResponse(DailyMissionResponse.DONE) }) {
                Text(stringResource(R.string.wellbeing_daily_mission_done))
            }
            Button(onClick = { onResponse(DailyMissionResponse.SKIP) }) {
                Text(stringResource(R.string.wellbeing_daily_mission_skip))
            }
            Button(onClick = { onResponse(DailyMissionResponse.NEW_IDEA) }) {
                Text(stringResource(R.string.wellbeing_daily_mission_new_idea))
            }
        }
    }
}

/** Intentional-use reflection prompt after repeated rapid re-entry. `CONTINUE` is never framed as
 * failure (PCA-WELL-002) -- it is presented as an equally valid, equally sized option. */
@Composable
fun ReflectionPromptScreen(
    state: ReflectionPromptViewState,
    onResponse: (ReflectionResponse) -> Unit,
) {
    Column(modifier = Modifier.padding(16.dp)) {
        Text(text = stringResource(R.string.wellbeing_reflection_title), style = MaterialTheme.typography.titleMedium)
        Text(text = state.bodyText, style = MaterialTheme.typography.bodyLarge)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = { onResponse(ReflectionResponse.CONTINUE) }) {
                Text(stringResource(R.string.wellbeing_reflection_continue))
            }
            Button(onClick = { onResponse(ReflectionResponse.TAKE_A_SHORT_BREAK) }) {
                Text(stringResource(R.string.wellbeing_reflection_take_break))
            }
            Button(onClick = { onResponse(ReflectionResponse.TRY_SOMETHING_USEFUL) }) {
                Text(stringResource(R.string.wellbeing_reflection_try_useful))
            }
        }
    }
}
