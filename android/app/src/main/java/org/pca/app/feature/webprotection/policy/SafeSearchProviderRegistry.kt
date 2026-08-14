package org.pca.app.feature.webprotection.policy

/**
 * doc 14 layer 1: "safe-search/restricted-mode configuration where the destination/service supports
 * it." This registry names only REAL, provider-documented enforcement mechanisms -- a query
 * parameter PCA's own Safe Browser can inject on navigation, and/or a SafeSearch-ENFORCING DNS CNAME
 * target the destination itself documents (e.g. Google's `forcesafesearch.google.com`, YouTube's
 * `restrict.youtube.com`) -- never a generic "all search engines are safe now" invention. A domain
 * with no entry here is UNSUPPORTED: [findSafeSearchProviderCapability] returns null and every
 * function below honestly no-ops (returns the input unchanged / null) rather than silently claiming
 * enforcement that cannot actually happen. This is the concrete mechanism
 * [resolveEffectiveSafeSearchMode] in `WebRulePolicy.kt` was already structurally anticipating
 * ("must never be reported as enforced when `serviceSupportsSafeSearch` is false") -- that function
 * computes WHETHER a family policy wants SafeSearch; this registry is the separate, on-device ground
 * truth of HOW (if at all) a given destination can actually be made to enforce it.
 */

data class SafeSearchQueryParameterMechanism(
    val paramName: String,
    /** Only the modes this provider's query parameter actually distinguishes -- a mode absent here has no query-parameter mechanism even if the provider has one for a different mode. */
    val valueForMode: Map<SafeSearchMode, String>,
)

data class SafeSearchDnsMechanism(
    /** Only the modes this provider documents a distinct SafeSearch-enforcing DNS CNAME target for. */
    val hostForMode: Map<SafeSearchMode, String>,
)

data class SafeSearchProviderCapability(
    val providerDomainSuffixes: List<String>,
    val queryParameter: SafeSearchQueryParameterMechanism?,
    val dns: SafeSearchDnsMechanism?,
)

/**
 * Real, provider-documented SafeSearch entries only -- extend deliberately, never speculatively.
 * Sources: Google Search's `safe=active` parameter and `forcesafesearch.google.com` DNS-level
 * enforcement; YouTube's `restrict.youtube.com` (strict) / `restrictmoderate.youtube.com` (moderate)
 * Restricted Mode DNS targets; Bing's `adlt=strict|moderate` parameter and `strict.bing.com` DNS
 * target; DuckDuckGo's `kp=1|-1` parameter (DuckDuckGo publishes no SafeSearch-enforcing DNS CNAME,
 * so its [dns] entry is honestly null).
 */
val SAFE_SEARCH_PROVIDER_REGISTRY: List<SafeSearchProviderCapability> = listOf(
    SafeSearchProviderCapability(
        providerDomainSuffixes = listOf("google.com"),
        queryParameter = SafeSearchQueryParameterMechanism(
            paramName = "safe",
            valueForMode = mapOf(SafeSearchMode.STRICT to "active", SafeSearchMode.MODERATE to "active"),
        ),
        dns = SafeSearchDnsMechanism(
            hostForMode = mapOf(
                SafeSearchMode.STRICT to "forcesafesearch.google.com",
                SafeSearchMode.MODERATE to "forcesafesearch.google.com",
            ),
        ),
    ),
    SafeSearchProviderCapability(
        providerDomainSuffixes = listOf("youtube.com", "youtube-nocookie.com"),
        queryParameter = null, // no reliable, provider-documented universal query-parameter equivalent
        dns = SafeSearchDnsMechanism(
            hostForMode = mapOf(
                SafeSearchMode.STRICT to "restrict.youtube.com",
                SafeSearchMode.MODERATE to "restrictmoderate.youtube.com",
            ),
        ),
    ),
    SafeSearchProviderCapability(
        providerDomainSuffixes = listOf("bing.com"),
        queryParameter = SafeSearchQueryParameterMechanism(
            paramName = "adlt",
            valueForMode = mapOf(SafeSearchMode.STRICT to "strict", SafeSearchMode.MODERATE to "moderate"),
        ),
        dns = SafeSearchDnsMechanism(hostForMode = mapOf(SafeSearchMode.STRICT to "strict.bing.com")),
    ),
    SafeSearchProviderCapability(
        providerDomainSuffixes = listOf("duckduckgo.com"),
        queryParameter = SafeSearchQueryParameterMechanism(
            paramName = "kp",
            valueForMode = mapOf(SafeSearchMode.STRICT to "1", SafeSearchMode.MODERATE to "-1"),
        ),
        dns = null, // DuckDuckGo documents no SafeSearch-enforcing DNS CNAME -- honestly absent, never guessed.
    ),
)

private fun domainMatchesSuffix(domain: CanonicalDomain, suffix: String): Boolean =
    domain == suffix || domain.endsWith(".$suffix")

fun findSafeSearchProviderCapability(domain: CanonicalDomain): SafeSearchProviderCapability? =
    SAFE_SEARCH_PROVIDER_REGISTRY.firstOrNull { capability -> capability.providerDomainSuffixes.any { domainMatchesSuffix(domain, it) } }

/** True only when the registry actually names a real mechanism (query-parameter or DNS) for [domain] -- the ground-truth answer to "can this destination actually be made to enforce SafeSearch," independent of whether a family's policy wants it. */
fun providerSupportsSafeSearch(domain: CanonicalDomain): Boolean = findSafeSearchProviderCapability(domain) != null

/** DNS-layer lookup used by [org.pca.app.feature.webprotection.vpn.WebProtectionVpnService]: the SafeSearch-enforcing host to resolve INSTEAD of [domain] for [mode], or null if [mode] is OFF or the provider/mode has no DNS mechanism -- callers must then forward the ORIGINAL query untouched, never invent a host. */
fun safeSearchDnsHostFor(domain: CanonicalDomain, mode: SafeSearchMode): String? {
    if (mode == SafeSearchMode.OFF) return null
    return findSafeSearchProviderCapability(domain)?.dns?.hostForMode?.get(mode)
}
