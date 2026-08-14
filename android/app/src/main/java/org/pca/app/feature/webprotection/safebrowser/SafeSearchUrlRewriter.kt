package org.pca.app.feature.webprotection.safebrowser

import java.net.URI
import java.net.URLEncoder
import org.pca.app.feature.webprotection.policy.CanonicalDomain
import org.pca.app.feature.webprotection.policy.SafeSearchMode
import org.pca.app.feature.webprotection.policy.findSafeSearchProviderCapability

/**
 * The one place in this lane a full URL is legitimately read AND rewritten for SafeSearch purposes
 * (doc 14: "PCA Safe Browser... the only normal path in which PCA can intentionally observe a full
 * URL"). Deliberately kept in the `safebrowser` subpackage -- not `policy` -- so
 * [org.pca.app.feature.webprotection.privacy.WebProtectionPrivacyStaticScanTest]'s "only
 * `safebrowser/` files ever declare a raw `url` field" invariant keeps holding structurally; the
 * provider capability MODEL itself (domain-keyed, never a full URL) lives in
 * `policy/SafeSearchProviderRegistry.kt` and is shared with the VPN DNS layer, but actually reading/
 * writing a URL string only ever happens here.
 */
data class SafeSearchRewriteResult(val url: String, val applied: Boolean)

/**
 * Rewrites [url] with the provider's documented SafeSearch query parameter for [mode] (replacing
 * any pre-existing same-named parameter so a child cannot pre-supply an unsafe value that survives
 * the rewrite), or returns [url] UNCHANGED with `applied = false` if [mode] is OFF, the provider is
 * unsupported, or the provider has no query-parameter mechanism for this exact [mode] -- an honest,
 * inspectable signal rather than a silent no-op (doc 14's SafeSearch note: "must never be reported
 * as enforced" when it did not actually happen). Never touches any other part of the URL (path,
 * other parameters, fragment), and never throws on a malformed [url] -- that case also returns
 * unchanged/`applied = false` rather than breaking navigation.
 */
fun applySafeSearchQueryParameter(url: String, domain: CanonicalDomain, mode: SafeSearchMode): SafeSearchRewriteResult {
    if (mode == SafeSearchMode.OFF) return SafeSearchRewriteResult(url, applied = false)
    val mechanism = findSafeSearchProviderCapability(domain)?.queryParameter
        ?: return SafeSearchRewriteResult(url, applied = false)
    val value = mechanism.valueForMode[mode] ?: return SafeSearchRewriteResult(url, applied = false)

    val uri = try {
        URI(url)
    } catch (_: Exception) {
        return SafeSearchRewriteResult(url, applied = false)
    }

    val remainingParams = (uri.rawQuery?.split("&")?.filter { it.isNotEmpty() } ?: emptyList())
        .filterNot { it.substringBefore('=') == mechanism.paramName }
    val newParam = "${mechanism.paramName}=${URLEncoder.encode(value, "UTF-8")}"
    val newQuery = (remainingParams + newParam).joinToString("&")

    val rebuilt = try {
        URI(uri.scheme, uri.authority, uri.path, newQuery, uri.fragment).toString()
    } catch (_: Exception) {
        return SafeSearchRewriteResult(url, applied = false)
    }
    return SafeSearchRewriteResult(rebuilt, applied = true)
}
