package org.pca.app.feature.webprotection.ui

import android.annotation.SuppressLint
import android.net.http.SslError
import android.view.ViewGroup
import android.webkit.SslErrorHandler
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import org.pca.app.R
import org.pca.app.feature.webprotection.policy.WebDecisionOutcome
import org.pca.app.feature.webprotection.policy.WebLocale

/**
 * doc 6-16's real child-facing production surface. This Composable owns the
 * one `android.webkit.WebView` instance and bridges its chrome callbacks
 * into [SafeBrowserController] -- every main-frame navigation (typed URL,
 * link click, redirect, reload, history) is routed through
 * [SafeBrowserController.onMainFrameNavigation] before this WebView is ever
 * allowed to actually load it (doc 6/7's "no bypass path").
 */
@Composable
fun SafeBrowserScreen(controller: SafeBrowserController, locale: WebLocale, modifier: Modifier = Modifier) {
    val state by controller.screenState.collectAsState()
    var addressBarText by remember { mutableStateOf("") }
    var webViewRef by remember { mutableStateOf<WebView?>(null) }
    val currentController = rememberUpdatedState(controller)

    Surface(modifier = modifier.fillMaxSize()) {
        Column(modifier = Modifier.fillMaxSize()) {
            if (controller.coverage == WebProtectionCoverage.SAFE_LIMITED_MODE_GLOBAL_ONLY) {
                SafeLimitedModeBanner()
            }

            AddressBar(
                text = addressBarText,
                onTextChange = { addressBarText = it },
                onGo = {
                    val target = normalizeTypedInput(addressBarText)
                    if (target != null) currentController.value.onMainFrameNavigation(target)
                },
                loading = (state as? SafeBrowserScreenState.Browsing)?.isLoading == true,
            )

            when (val current = state) {
                is SafeBrowserScreenState.Browsing -> {
                    if (current.isLoading) LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
                    SafeBrowserWebView(
                        controller = controller,
                        pendingUrl = controller.pendingApprovedLoad,
                        onWebViewCreated = { webViewRef = it },
                        onAddressChanged = { addressBarText = it },
                    )
                }
                is SafeBrowserScreenState.Held -> {
                    HeldPage(current, locale, onAskParent = { currentController.value.submitAskParent() })
                }
            }
        }
    }
}

@Composable
private fun SafeLimitedModeBanner() {
    Card(modifier = Modifier.fillMaxWidth().padding(8.dp)) {
        Text(
            text = stringResource(R.string.safe_browser_safe_limited_mode_banner),
            style = MaterialTheme.typography.bodyMedium,
            modifier = Modifier.padding(12.dp),
        )
    }
}

@Composable
private fun AddressBar(text: String, onTextChange: (String) -> Unit, onGo: () -> Unit, loading: Boolean) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(8.dp),
        verticalAlignment = androidx.compose.ui.Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        OutlinedTextField(
            value = text,
            onValueChange = onTextChange,
            modifier = Modifier.weight(1f),
            singleLine = true,
            label = { Text(stringResource(R.string.safe_browser_address_bar_hint)) },
            keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(imeAction = ImeAction.Go),
            keyboardActions = KeyboardActions(onGo = { onGo() }),
        )
        if (loading) {
            CircularProgressIndicator(modifier = Modifier.size(20.dp))
        } else {
            Button(onClick = onGo) { Text(stringResource(R.string.safe_browser_go_button)) }
        }
    }
}

@SuppressLint("SetJavaScriptEnabled")
@Composable
private fun SafeBrowserWebView(
    controller: SafeBrowserController,
    pendingUrl: String?,
    onWebViewCreated: (WebView) -> Unit,
    onAddressChanged: (String) -> Unit,
) {
    val context = LocalContext.current
    AndroidView(
        modifier = Modifier.fillMaxSize(),
        factory = {
            WebView(context).apply {
                layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
                configureSecureSettings(this)
                webViewClient = safeBrowserWebViewClient(controller, onAddressChanged)
                onWebViewCreated(this)
            }
        },
        update = { webView ->
            // The controller is the only authority allowed to trigger an actual load -- this branch
            // fires exactly once per approved navigation (doc 6: "no bypass path").
            if (pendingUrl != null && webView.url != pendingUrl) {
                webView.loadUrl(pendingUrl)
            }
        },
    )
}

/**
 * doc 11's least-privilege WebView configuration. No `addJavascriptInterface`
 * anywhere in this file (doc 11/12: "if not required, do not use it") -- this
 * is navigation-based filtering only, never a privileged JS bridge.
 */
private fun configureSecureSettings(webView: WebView) {
    val settings = webView.settings
    settings.javaScriptEnabled = true // doc 12: modern web needs it; no privileged bridge is ever attached (grep gate: no addJavascriptInterface in this lane).
    settings.domStorageEnabled = true
    settings.allowFileAccess = false
    settings.allowContentAccess = false
    settings.mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW
    settings.setSupportMultipleWindows(false)
    settings.javaScriptCanOpenWindowsAutomatically = false
    settings.safeBrowsingEnabled = true
    // doc 11: production debugging must not silently remain enabled -- gated on the build's own DEBUG flag, never unconditional.
    WebView.setWebContentsDebuggingEnabled(org.pca.app.BuildConfig.DEBUG)
}

private fun safeBrowserWebViewClient(controller: SafeBrowserController, onAddressChanged: (String) -> Unit): WebViewClient =
    object : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            // doc 8: subresource loads (images, stylesheets, fonts, scripts, third-party trackers)
            // are never treated as a child browsing event or routed through the navigation policy
            // -- only the main frame is.
            if (!request.isForMainFrame) return false
            val url = request.url.toString()
            return when (controller.onMainFrameNavigation(url)) {
                NavigationRequestOutcome.ProceedToLoad -> false // let the WebView load this one, already-approved URL itself
                NavigationRequestOutcome.DoNotLoad -> true // intercepted: either being evaluated asynchronously, or rejected outright (bad scheme)
            }
        }

        override fun onPageFinished(view: WebView, url: String?) {
            controller.onPageFinished(url, view.canGoBack())
            onAddressChanged(url ?: "")
        }

        // doc 10: TLS hard rule -- ALWAYS cancel on a certificate error, NEVER let the handler
        // continue past it. No development fallback, no trust-all path, anywhere in this class.
        override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: SslError) {
            handler.cancel()
        }
    }

/** Best-effort typed-input normalization (bare "example.com" -> "https://example.com") -- never itself a filtering decision; the normalized URL still goes through [SafeBrowserController.onMainFrameNavigation] like any other navigation. Returns null for empty input (rejected before ever reaching the WebView). */
private fun normalizeTypedInput(raw: String): String? {
    val trimmed = raw.trim()
    if (trimmed.isEmpty()) return null
    return if (trimmed.contains("://")) trimmed else "https://$trimmed"
}

@Composable
private fun HeldPage(held: SafeBrowserScreenState.Held, locale: WebLocale, onAskParent: () -> Unit) {
    val decision = held.decision
    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text(
            text = stringResource(
                if (decision.outcome == WebDecisionOutcome.REVIEW) R.string.safe_browser_held_review_title else R.string.safe_browser_held_block_title,
            ),
            style = MaterialTheme.typography.headlineSmall,
            modifier = Modifier.semantics { heading() },
        )
        Text(text = decision.domain, style = MaterialTheme.typography.titleMedium)
        Text(text = decision.reasonCode, style = MaterialTheme.typography.bodyLarge)

        if (decision.requestable) {
            AskParentSection(held.askParentState, onAskParent)
        }
    }
}

@Composable
private fun AskParentSection(state: AskParentState, onAskParent: () -> Unit) {
    when (state) {
        AskParentState.NONE -> Button(onClick = onAskParent) { Text(stringResource(R.string.safe_browser_ask_parent_button)) }
        AskParentState.PENDING_SYNC_LOCAL -> Text(stringResource(R.string.safe_browser_ask_parent_pending_offline))
        AskParentState.SUBMITTED_TO_PARENT -> Text(stringResource(R.string.safe_browser_ask_parent_submitted))
        AskParentState.ALREADY_PENDING -> Text(stringResource(R.string.safe_browser_ask_parent_already_pending))
        AskParentState.NOT_REQUESTABLE -> Text(stringResource(R.string.safe_browser_ask_parent_not_requestable))
    }
}
