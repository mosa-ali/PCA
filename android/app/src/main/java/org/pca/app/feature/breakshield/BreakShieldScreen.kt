package org.pca.app.feature.breakshield

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import kotlin.time.Duration

/**
 * Full-screen, always-transparent Break Shield: what the child sees is exactly the derived
 * [BreakShieldViewState] — remaining time, the dhikr interaction, and the two explicit,
 * visible affordances (parent override, emergency exception). There is no enforcement path
 * that bypasses this screen silently.
 */
@Composable
fun BreakShieldScreen(
    state: BreakShieldViewState,
    onDhikrInteraction: () -> Unit,
    onRequestParentOverride: () -> Unit,
    onRequestEmergencyException: () -> Unit,
) {
    if (!state.isShieldVisible) return

    MaterialTheme {
        Surface(modifier = Modifier.fillMaxSize()) {
            Column(
                modifier = Modifier.fillMaxSize().padding(24.dp),
                verticalArrangement = Arrangement.Center,
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text(text = "Break Time", style = MaterialTheme.typography.headlineMedium)
                Text(
                    text = "Remaining: ${formatDuration(state.remainingBreak)}",
                    style = MaterialTheme.typography.bodyLarge,
                )
                Text(
                    text = "Dhikr interactions: ${state.dhikrInteractionCount}",
                    style = MaterialTheme.typography.bodyMedium,
                )
                if (state.canInteractWithDhikr) {
                    Button(onClick = onDhikrInteraction) { Text("Dhikr / Remembrance") }
                }
                Row {
                    if (state.canRequestParentOverride) {
                        Button(onClick = onRequestParentOverride) { Text("Ask a parent") }
                    }
                    if (state.canRequestEmergencyException) {
                        Button(onClick = onRequestEmergencyException) { Text("Emergency") }
                    }
                }
            }
        }
    }
}

internal fun formatDuration(duration: Duration): String {
    val totalSeconds = duration.inWholeSeconds.coerceAtLeast(0)
    val minutes = totalSeconds / 60
    val seconds = totalSeconds % 60
    return "%02d:%02d".format(minutes, seconds)
}

@Preview(showBackground = true)
@Composable
private fun BreakShieldScreenPreview() {
    BreakShieldScreen(
        state = BreakShieldViewState(
            isShieldVisible = true,
            remainingBreak = kotlin.time.Duration.parse("PT18M30S"),
            dhikrInteractionCount = 3,
            canInteractWithDhikr = true,
            canRequestParentOverride = true,
            canRequestEmergencyException = true,
            remainingActiveBeforeBreak = Duration.ZERO,
            completedBreakCount = 2,
            overriddenBreakCount = 0,
            isEmergencyExceptionActive = false,
        ),
        onDhikrInteraction = {},
        onRequestParentOverride = {},
        onRequestEmergencyException = {},
    )
}
