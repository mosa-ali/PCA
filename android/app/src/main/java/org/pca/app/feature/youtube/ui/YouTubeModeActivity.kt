package org.pca.app.feature.youtube.ui

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import org.pca.app.PcaApplication
import org.pca.app.R
import org.pca.app.accessibility.PcaAccessibilityContent

/**
 * PCA-FR-054 closure (Writer73): the real hosting Activity for [YouTubeModeScreen], which existed
 * as a fully-built, independently-tested Composable with zero navigation call sites anywhere in
 * the app -- no Activity, no entry point. Mirrors [org.pca.app.feature.webprotection.ui.SafeBrowserActivity]'s
 * structure exactly: plain `ComponentActivity` (no `BiometricPrompt` need here, unlike
 * [org.pca.app.security.ui.AdminSecurityActivity]), reads the single [PcaApplication.graph]
 * composition root's already-wired production ports, and owns no business logic beyond
 * constructing the one [YouTubeModeLoader] for its lifecycle.
 *
 * The evidence/flag read is asynchronous (real device identity + real Android usage-stats read),
 * so this screen renders an honest loading state while that resolves and a real error state if it
 * fails or no trusted family context exists yet -- never a stale/zero-usage placeholder in the
 * meantime (see [YouTubeModeLoadState]'s own doc comment).
 */
class YouTubeModeActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val graph = (application as PcaApplication).graph
        val loader = YouTubeModeLoader(
            identityProvider = graph.webProtectionIdentityContextProvider,
            usageAdapter = graph.modeAAndroidUsageAdapter,
            modeBFlagStore = graph.modeBFeatureFlagLocalStore,
        )

        setContent {
            PcaAccessibilityContent {
                MaterialTheme {
                    var loadState by remember { mutableStateOf<YouTubeModeLoadState>(YouTubeModeLoadState.Loading) }
                    LaunchedEffect(Unit) {
                        loadState = loader.load()
                    }
                    when (val state = loadState) {
                        is YouTubeModeLoadState.Loading -> YouTubeModeLoadingContent()
                        is YouTubeModeLoadState.Success -> YouTubeModeScreen(state = state.viewState)
                        is YouTubeModeLoadState.Error -> YouTubeModeErrorContent()
                    }
                }
            }
        }
    }
}

@Composable
private fun YouTubeModeLoadingContent() {
    Surface(modifier = Modifier.fillMaxSize()) {
        Column(
            modifier = Modifier.fillMaxSize().padding(16.dp),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            CircularProgressIndicator()
            Text(
                text = stringResource(R.string.youtube_mode_a_status_loading),
                style = MaterialTheme.typography.bodyMedium,
                modifier = Modifier.padding(top = 12.dp),
            )
        }
    }
}

@Composable
private fun YouTubeModeErrorContent() {
    Surface(modifier = Modifier.fillMaxSize()) {
        Column(
            modifier = Modifier.fillMaxSize().padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(
                text = stringResource(R.string.youtube_mode_screen_title),
                style = MaterialTheme.typography.headlineSmall,
                modifier = Modifier.semantics { heading() },
            )
            Text(
                text = stringResource(R.string.youtube_mode_unavailable_error),
                style = MaterialTheme.typography.bodyLarge,
            )
        }
    }
}
