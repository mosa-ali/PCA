package org.pca.app.feature.youtube.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import java.util.concurrent.TimeUnit
import org.pca.app.R
import org.pca.app.feature.youtube.policy.UsageCapabilityStatus

/**
 * PCA-FR-054: the parent-facing surface that honestly frames the Mode A/Mode B trade-off (doc 15)
 * -- until now no Composable existed anywhere under `feature/youtube` at all. Mode A (app-usage-
 * only signal, no per-video detail) is the only mode this build can ever report as active; Mode B
 * (would show specific-video-level detail) is rendered strictly as an informational,
 * non-interactive "not available" state -- there is intentionally no switch, button, or any other
 * affordance here that could make a viewer believe Mode B can be turned on from this screen. Doc
 * 15's release gate for Mode B (an explicit owner enable decision plus a recorded terms
 * re-verification, see [org.pca.app.feature.youtube.policy.isModeBActive]) is out of this lane's
 * scope to satisfy or bypass; this screen's only job is to describe the trade-off truthfully.
 */
@Composable
fun YouTubeModeScreen(state: YouTubeModeViewState, modifier: Modifier = Modifier) {
    Surface(modifier = modifier.fillMaxSize()) {
        Column(
            modifier = Modifier.fillMaxSize().padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(
                text = stringResource(R.string.youtube_mode_screen_title),
                style = MaterialTheme.typography.headlineSmall,
                modifier = Modifier.semantics { heading() },
            )
            ModeACard(state)
            ModeBUnavailableCard()
        }
    }
}

@Composable
private fun ModeACard(state: YouTubeModeViewState) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(text = stringResource(R.string.youtube_mode_a_title), style = MaterialTheme.typography.titleMedium)
            Text(text = stringResource(R.string.youtube_mode_a_description), style = MaterialTheme.typography.bodyMedium)
            Text(text = modeAStatusLabel(state), style = MaterialTheme.typography.bodyLarge)
        }
    }
}

/**
 * PCA-FR-054 + PCA-FR-044: this card is deliberately never a switch/checkbox -- Mode B is
 * described, not offered. [CardDefaults.cardColors] (the ordinary card styling) is used
 * intentionally rather than an error/warning color, since "not available yet" is not itself an
 * error condition here (doc 06/15 "REQUIRES_FURTHER_OWNER_DECISION" is a normal, honestly-labeled
 * state, not a fault).
 */
@Composable
private fun ModeBUnavailableCard() {
    Card(modifier = Modifier.fillMaxWidth(), colors = CardDefaults.cardColors()) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(text = stringResource(R.string.youtube_mode_b_title), style = MaterialTheme.typography.titleMedium)
            Text(text = stringResource(R.string.youtube_mode_b_description), style = MaterialTheme.typography.bodyMedium)
            Text(text = stringResource(R.string.youtube_mode_b_unavailable), style = MaterialTheme.typography.bodyLarge)
        }
    }
}

@Composable
private fun modeAStatusLabel(state: YouTubeModeViewState): String {
    val evidence = state.modeAEvidence
    return when {
        evidence == null -> stringResource(R.string.youtube_mode_a_status_loading)
        evidence.capabilityStatus == UsageCapabilityStatus.UNSUPPORTED -> stringResource(R.string.youtube_mode_a_status_unsupported)
        evidence.capabilityStatus == UsageCapabilityStatus.REVOKED -> stringResource(R.string.youtube_mode_a_status_permission_needed)
        !state.hasMeasuredUsage() -> stringResource(R.string.youtube_mode_a_status_loading)
        else -> {
            val minutes = TimeUnit.MILLISECONDS.toMinutes((evidence.durationMs ?: 0L).coerceAtLeast(0L))
            val locale = LocalConfiguration.current.locales[0]
            val localizedMinutes = String.format(locale, "%d", minutes)
            stringResource(R.string.youtube_mode_a_status_measured, localizedMinutes)
        }
    }
}
