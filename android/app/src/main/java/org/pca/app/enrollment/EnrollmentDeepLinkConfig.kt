package org.pca.app.enrollment

import org.pca.app.BuildConfig

/**
 * The exact scheme/host this app's invitation deep link accepts -- deliberately a fixed pair, no
 * wildcard, so [UriEnrollmentLinkParser] can never treat an arbitrary foreign scheme/domain as a
 * valid invitation link. Kept in one place so [AndroidManifest.xml]'s intent-filter and the
 * runtime parser it feeds can never drift apart silently.
 *
 * The custom scheme remains supported for compatibility. HTTPS App Links use the existing PCA
 * Public Web origin and a narrow `/enroll/` path. Parent Web and Android builds must receive the
 * same `PCA_CHILD_APP_PUBLIC_ORIGIN`; App Links are not domain-verified until Public Web serves a
 * matching `assetlinks.json` for the signed release certificate. The bootstrap HTTP call itself
 * (`HttpDeviceBootstrapApiClient`/`BootstrapEndpointConfig`) always enforces HTTPS independently
 * of how the link that started the flow was delivered.
 */
object EnrollmentDeepLinkConfig {
    const val EXPECTED_SCHEME = "pca"
    const val EXPECTED_HOST = "enroll"

    /**
     * Android App Link origin and route prefix. The public host is supplied by the Gradle build;
     * Parent Web and Android builds must receive the same `PCA_CHILD_APP_PUBLIC_ORIGIN`. Merely
     * configuring this filter does not prove Android domain verification: keep that gate open
     * until Public Web serves `assetlinks.json` with the fingerprint of the signed release.
     */
    const val APP_LINK_SCHEME = "https"
    const val APP_LINK_HOST = BuildConfig.PCA_CHILD_APP_LINK_HOST
    const val APP_LINK_PATH_PREFIX = BuildConfig.PCA_CHILD_APP_LINK_PATH_PREFIX
}
