package org.pca.app.feature.webprotection.privacy

import java.io.File
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test

/**
 * Lightweight static scan of this module's main sources (mirrors
 * `feature/wellbeing/privacy/WellbeingPrivacyStaticScanTest`'s convention --
 * no instrumented network/log-capture harness exists in this project).
 * Confirms two structural invariants required by this lane's mission:
 *
 * 1. No file under `feature/webprotection` (main sources) references any
 *    TLS-interception/MITM-capable API -- there is no code path anywhere in
 *    this lane that could decrypt, install a certificate into, or trust-
 *    override HTTPS traffic outside the destination's own certificate.
 * 2. Only `safebrowser/` subpackage files ever reference a raw `url`/
 *    `pageTitle` field -- every other subpackage (`policy/`, `engine/`,
 *    `vpn/`) is domain-only, so a full URL is structurally unreachable
 *    outside the PCA Safe Browser's own legitimate browsing context (this
 *    lane's hard requirement: no device-wide readable URL surveillance
 *    capability spanning arbitrary apps).
 */
class WebProtectionPrivacyStaticScanTest {

    private fun mainSourceRoot(): File? {
        val candidates = listOf(
            "src/main/java/org/pca/app/feature/webprotection",
            "android/app/src/main/java/org/pca/app/feature/webprotection",
            "app/src/main/java/org/pca/app/feature/webprotection",
        )
        return candidates.map { File(it) }.firstOrNull { it.isDirectory }
    }

    private val forbiddenInterceptionTokens = listOf(
        "X509TrustManager",
        "TrustManagerFactory",
        "SSLContext",
        "HostnameVerifier",
        "installCertificate",
        "KeyChain.createInstallIntent",
        "javax.net.ssl",
        "MITM",
    )

    @Test
    fun `no source file in the webprotection module references a TLS-interception-capable API`() {
        val root = mainSourceRoot()
        assumeTrue("could not locate feature/webprotection main sources from test working directory", root != null)

        val offenders = root!!.walkTopDown()
            .filter { it.isFile && it.extension == "kt" }
            .flatMap { file -> forbiddenInterceptionTokens.filter { file.readText().contains(it) }.map { file.name to it } }
            .toList()

        assertTrue("files referencing TLS-interception-capable APIs: $offenders", offenders.isEmpty())
    }

    @Test
    fun `no source file outside safebrowser subpackage declares a url or pageTitle field`() {
        val root = mainSourceRoot()
        assumeTrue("could not locate feature/webprotection main sources from test working directory", root != null)

        val offenders = root!!.walkTopDown()
            .filter { it.isFile && it.extension == "kt" }
            .filterNot { it.path.replace('\\', '/').contains("/safebrowser/") }
            .filter { file ->
                val text = file.readText()
                Regex("""\bval\s+(url|pageTitle)\s*:""").containsMatchIn(text)
            }
            .toList()

        assertTrue("non-Safe-Browser files declaring a raw url/pageTitle field: $offenders", offenders.isEmpty())
    }

    /** doc 10/42: `onReceivedSslError` may exist only to fail closed -- this scan fails the build the moment any `.proceed()` call is added anywhere in this lane, so a future "development fallback" cannot silently reintroduce a TLS bypass. */
    @Test
    fun `no source file in the webprotection module ever calls SslErrorHandler proceed`() {
        val root = mainSourceRoot()
        assumeTrue("could not locate feature/webprotection main sources from test working directory", root != null)

        val offenders = root!!.walkTopDown()
            .filter { it.isFile && it.extension == "kt" }
            .filter { it.readText().contains(".proceed(") }
            .map { it.name }
            .toList()

        assertTrue("files calling .proceed() (a potential TLS-error bypass): $offenders", offenders.isEmpty())
    }

    /** doc 43: no raw/full URL may ever reach a production log/analytics/telemetry call anywhere in this lane. */
    @Test
    fun `no source file in the webprotection module logs, prints or sends telemetry`() {
        val root = mainSourceRoot()
        assumeTrue("could not locate feature/webprotection main sources from test working directory", root != null)
        val forbiddenLoggingTokens = listOf("Log.", "println(", "printStackTrace(", "analytics", "telemetry")

        val offenders = root!!.walkTopDown()
            .filter { it.isFile && it.extension == "kt" }
            .flatMap { file -> forbiddenLoggingTokens.filter { file.readText().contains(it) }.map { file.name to it } }
            .toList()

        assertTrue("files referencing a logging/telemetry API: $offenders", offenders.isEmpty())
    }
}
