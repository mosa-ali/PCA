package org.pca.app.feature.webprotection.vpn

import org.pca.app.feature.webprotection.policy.SafeSearchMode
import org.pca.app.foundation.PersistentStateStore

/**
 * Family-wide SafeSearch mode applied AT THE VPN DNS LAYER ONLY (doc 14 layers 1/2) -- distinct
 * from the per-navigation `SafeSearchDirective` [org.pca.app.feature.webprotection.safebrowser.SafeBrowserNavigationPolicy]
 * already accepts per call. There is no production caller anywhere in this codebase yet that
 * delivers a real parent-authored family policy of ANY kind without the separate
 * `PRODUCTION_CRYPTO_SUITE` human security review clearing (see e.g.
 * [org.pca.app.feature.webprotection.ingress.WebRulePolicyConsumer]'s own doc comment) -- following
 * that exact same honesty discipline, this store defaults to [SafeSearchMode.OFF] until something
 * explicitly sets a different mode, so [WebProtectionVpnService] never fabricates SafeSearch
 * enforcement nobody actually configured. A thin single-value store over the same
 * [PersistentStateStore] port every other small state store in this lane uses (doc 35: never a
 * second storage mechanism).
 */
class VpnSafeSearchPolicyStore(private val store: PersistentStateStore, private val key: String = KEY) {
    fun currentMode(): SafeSearchMode =
        store.getString(key)?.let { raw -> runCatching { SafeSearchMode.valueOf(raw) }.getOrNull() } ?: SafeSearchMode.OFF

    fun setMode(mode: SafeSearchMode) {
        store.putString(key, mode.name)
    }

    private companion object {
        const val KEY = "webprotection_vpn_safesearch_mode_v1"
    }
}
