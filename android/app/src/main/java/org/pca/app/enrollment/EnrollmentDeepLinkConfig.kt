package org.pca.app.enrollment

/**
 * The exact scheme/host this app's invitation deep link accepts -- deliberately a fixed pair, no
 * wildcard, so [UriEnrollmentLinkParser] can never treat an arbitrary foreign scheme/domain as a
 * valid invitation link. Kept in one place so [AndroidManifest.xml]'s intent-filter and the
 * runtime parser it feeds can never drift apart silently.
 *
 * Uses a custom (non-https) URI scheme rather than Android App Links (verified https:// domain)
 * because this codebase has no `assetlinks.json`/domain-verification infrastructure yet -- see
 * this lane's final report for the App Links migration note. The bootstrap HTTP call itself
 * (`HttpDeviceBootstrapApiClient`/`BootstrapEndpointConfig`) is unaffected either way and always
 * enforces HTTPS independently of how the link that started the flow was delivered.
 */
object EnrollmentDeepLinkConfig {
    const val EXPECTED_SCHEME = "pca"
    const val EXPECTED_HOST = "enroll"
}
