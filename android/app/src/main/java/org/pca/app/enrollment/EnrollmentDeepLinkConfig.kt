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

    /**
     * PCA-ADD-ENR-008: Android App Link (verified https://) continuation domain, additive
     * alongside the custom `pca://enroll` scheme above -- never a replacement for it. A custom
     * URI scheme cannot support the "app not installed yet -> Play Store install -> return to the
     * same enrollment flow" continuation Addendum 001 requires, because the OS has nothing
     * registered to handle an unrecognized custom scheme until the app is already installed. A
     * verified Android App Link (https://, Digital Asset Links `assetlinks.json` hosted at this
     * exact domain, `autoVerify="true"` in AndroidManifest.xml) is the documented, standard
     * mechanism that supports both: opens directly in-app when installed, and falls through to
     * the browser (which can offer the Play Store listing) when it is not.
     *
     * `APP_LINK_HOST` is STILL a placeholder domain the project does not own (pca.app; the owned
     * domain is pcasafe.com). It is deliberately NOT changed by the 2026-09-08 final assessment,
     * which did replace [org.pca.app.runtime.graph.PcaAppGraph]'s bootstrap-endpoint placeholder
     * with the real api.pcasafe.com hostname: which owned host serves `assetlinks.json` for the
     * App Link (and therefore which host/path this filter must claim -- an "enroll" subdomain, or a
     * path prefix under www.pcasafe.com) is an owner infrastructure decision tracked by the
     * ANDROID_APP_LINK_ASSETLINKS_HOSTING gate, and claiming an owned host without a path prefix
     * would make this app intercept every public-site link. Until that decision exists, an
     * unverified placeholder only ever produces Android's normal disambiguation behaviour. Digital Asset Links verification (hosting `assetlinks.json` at
     * `https://APP_LINK_HOST/.well-known/assetlinks.json`) is a domain/production-infrastructure
     * decision outside this module's scope -- until that file is hosted, Android will still accept
     * this intent-filter but will show the normal disambiguation/browser behavior for an
     * unverified https link rather than silently deep-linking, which is the correct, honest
     * interim behavior (never a false claim of working store-install continuation before the
     * domain is actually verified).
     */
    const val APP_LINK_SCHEME = "https"
    const val APP_LINK_HOST = "enroll.pca.app"
}
