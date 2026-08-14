package org.pca.app.feature.webprotection.ui

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import org.pca.app.feature.webprotection.identity.WebProtectionIdentity
import org.pca.app.feature.webprotection.identity.WebProtectionIdentityContextProvider
import org.pca.app.feature.webprotection.policy.WebLocale
import org.pca.app.feature.webprotection.safebrowser.BlockDecisionState
import org.pca.app.feature.webprotection.safebrowser.NavigationError
import org.pca.app.feature.webprotection.safebrowser.NavigationOutcome
import org.pca.app.feature.webprotection.safebrowser.ParentUnblockRequestService
import org.pca.app.feature.webprotection.safebrowser.SafeBrowserNavigationPolicy
import org.pca.app.feature.webprotection.safebrowser.UnblockRequestError
import org.pca.app.runtime.child.ChildRequestOfflineQueue
import org.pca.app.runtime.port.ChildRequestPayload
import org.pca.app.runtime.port.FamilySyncConnectionState
import org.pca.app.runtime.port.FamilySyncRuntimePort

/** doc 13: this device's own trusted context can never be blank -- this is the ONLY place a [WebProtectionIdentity.TrustedFamilyContextUnavailable] session is given a placeholder engine input, and that placeholder is documented to structurally never match a real family's rules (see doc comment below). */
private const val SAFE_LIMITED_MODE_FAMILY_ID = "SAFE_LIMITED_MODE_NO_FAMILY_CONTEXT"

/** Supported navigation schemes (doc 9) -- production prefers HTTPS; HTTP remains accepted for now (no platform policy in this codebase yet forbids it), every other scheme (`javascript:`, `intent:`, `file:`, `content:`, custom app schemes) is rejected outright before ever reaching [SafeBrowserNavigationPolicy]. */
private val SUPPORTED_SCHEMES = setOf("https", "http")

sealed class NavigationRequestOutcome {
    /** Caller should let the WebView actually load this exact URL now (the one and only case [SafeBrowserController] does not itself hold). */
    object ProceedToLoad : NavigationRequestOutcome()
    /** Caller must not load anything -- either evaluation is in flight (state will update asynchronously) or the URL was rejected outright (invalid scheme/malformed) and no navigation happens at all. */
    object DoNotLoad : NavigationRequestOutcome()
}

/**
 * doc 6/7's real navigation-policy seam: every main-frame HTTP/HTTPS
 * navigation (typed URL, link click, redirect, reload, history nav) is
 * expected to call [onMainFrameNavigation] before the WebView is allowed to
 * load it. This class holds no WebView reference itself -- it is a plain,
 * unit-testable controller; [org.pca.app.feature.webprotection.ui.SafeBrowserScreen]
 * is the only caller that bridges it to a real `android.webkit.WebView`.
 */
class SafeBrowserController(
    private val identityContextProvider: WebProtectionIdentityContextProvider,
    private val navigationPolicy: SafeBrowserNavigationPolicy,
    private val unblockRequestService: ParentUnblockRequestService,
    private val childRequestQueue: ChildRequestOfflineQueue,
    private val familySyncRuntimePort: FamilySyncRuntimePort,
    private val scope: CoroutineScope,
    private val locale: () -> WebLocale = { WebLocale.EN },
    private val idGenerator: () -> String = { java.util.UUID.randomUUID().toString() },
) {
    private val _screenState = MutableStateFlow<SafeBrowserScreenState>(
        SafeBrowserScreenState.Browsing(currentUrl = null, canGoBack = false, isLoading = false),
    )
    val screenState: StateFlow<SafeBrowserScreenState> = _screenState.asStateFlow()

    /** The single URL this controller has itself approved and is telling the WebView chrome to actually load -- [org.pca.app.feature.webprotection.ui.SafeBrowserScreen]'s `shouldOverrideUrlLoading` must let exactly this URL through once, then this is cleared. Never a bypass for anything else. */
    var pendingApprovedLoad: String? = null
        private set

    val coverage: WebProtectionCoverage
        get() = when (identityContextProvider.current()) {
            is WebProtectionIdentity.Trusted -> WebProtectionCoverage.FULL_FAMILY_POLICY
            WebProtectionIdentity.TrustedFamilyContextUnavailable -> WebProtectionCoverage.SAFE_LIMITED_MODE_GLOBAL_ONLY
        }

    /**
     * Called by the WebView chrome for every prospective main-frame
     * navigation (including redirect targets -- doc 7). Returns
     * [NavigationRequestOutcome.DoNotLoad] and always defers the real
     * decision to a coroutine; [NavigationRequestOutcome.ProceedToLoad] is
     * only ever returned for the one URL this controller already approved
     * via [pendingApprovedLoad] (the chrome layer calls this again for that
     * exact URL once it re-triggers the load itself).
     */
    fun onMainFrameNavigation(url: String): NavigationRequestOutcome {
        if (url == pendingApprovedLoad) {
            pendingApprovedLoad = null
            return NavigationRequestOutcome.ProceedToLoad
        }

        val scheme = runCatching { java.net.URI(url).scheme?.lowercase() }.getOrNull()
        if (scheme == null || scheme !in SUPPORTED_SCHEMES) {
            // doc 9: no bypass through javascript:/intent:/file:/content:/custom schemes -- never loaded, never evaluated.
            return NavigationRequestOutcome.DoNotLoad
        }

        _screenState.update { SafeBrowserScreenState.Browsing(currentUrl = url, canGoBack = true, isLoading = true) }
        scope.launch { evaluate(url) }
        return NavigationRequestOutcome.DoNotLoad
    }

    /** Set by the chrome layer once the WebView actually finishes loading an approved page/reports its current URL. */
    fun onPageFinished(url: String?, canGoBack: Boolean) {
        _screenState.update { SafeBrowserScreenState.Browsing(currentUrl = url, canGoBack = canGoBack, isLoading = false) }
    }

    private suspend fun evaluate(url: String) {
        val identity = identityContextProvider.current()
        val (familyId, profileId, deviceId) = when (identity) {
            is WebProtectionIdentity.Trusted -> Triple(identity.familyId, identity.profileId, identity.deviceId)
            WebProtectionIdentity.TrustedFamilyContextUnavailable ->
                Triple(SAFE_LIMITED_MODE_FAMILY_ID, SAFE_LIMITED_MODE_FAMILY_ID, SAFE_LIMITED_MODE_FAMILY_ID)
        }

        val outcome = try {
            navigationPolicy.evaluateNavigation(
                familyId = familyId,
                profileId = profileId,
                deviceId = deviceId,
                url = url,
                locale = locale(),
            )
        } catch (_: NavigationError.InvalidUrl) {
            _screenState.update { SafeBrowserScreenState.Browsing(currentUrl = null, canGoBack = false, isLoading = false) }
            return
        }

        when (outcome) {
            is NavigationOutcome.Allow -> {
                // outcome.loadUrl is the URL to actually load -- identical to `url` unless a
                // provider-supported SafeSearch rewrite applied (see SafeSearchUrlRewriter).
                pendingApprovedLoad = outcome.loadUrl
                _screenState.update { SafeBrowserScreenState.Browsing(currentUrl = outcome.loadUrl, canGoBack = true, isLoading = true) }
            }
            is NavigationOutcome.Held -> {
                _screenState.update { SafeBrowserScreenState.Held(outcome.blockDecision, AskParentState.NONE) }
            }
        }
    }

    /** doc 18: connects the held page's "Ask Parent" action to the existing [ParentUnblockRequestService] + [ChildRequestOfflineQueue] -- never a synchronous self-approval; the request is only ever created in a PENDING/PENDING_SYNC_LOCAL state. */
    fun submitAskParent() {
        val current = _screenState.value
        if (current !is SafeBrowserScreenState.Held) return
        val decision = current.decision

        val request = try {
            unblockRequestService.submit(decision)
        } catch (_: UnblockRequestError.DecisionNotRequestable) {
            _screenState.update { SafeBrowserScreenState.Held(decision, AskParentState.NOT_REQUESTABLE) }
            return
        } catch (_: UnblockRequestError.AlreadyPending) {
            _screenState.update { SafeBrowserScreenState.Held(decision, AskParentState.ALREADY_PENDING) }
            return
        }

        childRequestQueue.enqueue(
            ChildRequestPayload(
                requestId = request.id,
                kind = "WEB_UNBLOCK_REQUEST",
                detail = decision.domain,
                createdAtEpochMillis = request.requestedAtEpochMillis,
            ),
        )

        _screenState.update { SafeBrowserScreenState.Held(decision, AskParentState.PENDING_SYNC_LOCAL) }

        scope.launch {
            if (familySyncRuntimePort.currentConnectionState() == FamilySyncConnectionState.LIVE) {
                val submitted = childRequestQueue.flush(familySyncRuntimePort)
                if (submitted > 0) {
                    val latest = _screenState.value
                    if (latest is SafeBrowserScreenState.Held && latest.decision.id == decision.id) {
                        _screenState.update { SafeBrowserScreenState.Held(decision, AskParentState.SUBMITTED_TO_PARENT) }
                    }
                }
            }
        }
    }
}
