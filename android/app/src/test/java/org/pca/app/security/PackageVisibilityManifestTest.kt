package org.pca.app.security

import java.io.File
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * PCA-FR-045/PCA-FR-131 package-visibility guard (Android 11 / API 30+, enforced because this app
 * targets SDK 35). Two invariants, both structural:
 *
 * 1. A `<queries>` element MUST exist and MUST declare the MAIN/LAUNCHER intent -- without it
 *    every cross-package `PackageManager` call from
 *    [org.pca.app.runtime.installobserver.InstalledAppEventReceiver] is filtered, so the
 *    install observer silently records a null label and a fabricated install time for every real
 *    install (and the OS does not even deliver `PACKAGE_ADDED` for an invisible package).
 * 2. `QUERY_ALL_PACKAGES` MUST NOT be declared -- it is a Play-policy-restricted permission whose
 *    core-functionality justification this app's genuine need does not reach. Adding it must be a
 *    deliberate, reviewed product decision, never an incidental fix for a filtered query.
 *
 * A text scan (rather than a Robolectric `ApplicationInfo` read like [AllowBackupManifestTest]'s)
 * because `<queries>` has no parsed, app-readable counterpart the way `allowBackup` has
 * `FLAG_ALLOW_BACKUP`; the manifest source is the only place this fact exists. Directory
 * resolution hard-fails rather than skipping, the same discipline as
 * `WebProtectionPrivacyStaticScanTest`/`SecurityStaticCheckTest`.
 */
class PackageVisibilityManifestTest {

    private fun manifest(): String {
        val candidates = listOf(
            File("src/main/AndroidManifest.xml"),
            File("app/src/main/AndroidManifest.xml"),
            File("android/app/src/main/AndroidManifest.xml"),
        )
        return candidates.firstOrNull { it.isFile }?.readText()
            ?: error("Could not locate AndroidManifest.xml from working directory ${File(".").absolutePath}")
    }

    /** Strips XML comments so the rationale comment explaining why QUERY_ALL_PACKAGES is absent
     * cannot itself trip the check that only cares about real declarations -- same discipline as
     * `SecurityStaticCheckTest.entitySources`. */
    private fun declarations(): String =
        manifest().replace(Regex("<!--.*?-->", RegexOption.DOT_MATCHES_ALL), "")

    @Test
    fun `the manifest declares a scoped queries element for launchable apps`() {
        val xml = declarations()
        assertTrue("AndroidManifest.xml declares no <queries> element", xml.contains("<queries>"))

        val queriesBlock = Regex("<queries>(.*?)</queries>", RegexOption.DOT_MATCHES_ALL)
            .find(xml)?.groupValues?.get(1)
            ?: error("<queries> element is present but unclosed/unparseable")

        assertTrue(
            "<queries> must declare the MAIN/LAUNCHER intent the install observer's PackageManager lookups depend on",
            queriesBlock.contains("android.intent.action.MAIN") &&
                queriesBlock.contains("android.intent.category.LAUNCHER"),
        )
    }

    @Test
    fun `the manifest never declares QUERY_ALL_PACKAGES`() {
        assertFalse(
            "QUERY_ALL_PACKAGES is a Play-policy-restricted permission -- scope a <queries> element instead",
            declarations().contains("QUERY_ALL_PACKAGES"),
        )
    }
}
