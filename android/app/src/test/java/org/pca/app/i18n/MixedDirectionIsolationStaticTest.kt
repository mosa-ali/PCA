package org.pca.app.i18n

import java.io.File
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * PCA-16 / PCA-NFR-041 (mixed-direction content): domains, key fingerprints and machine codes are
 * LTR tokens rendered inside Arabic UI. They must be bidi-isolated, and an untrusted token (a
 * hostname) must have bidi control characters stripped first so a hostile name cannot reorder the
 * surrounding labels. [BidiUtils] has existed since PCA-16's first pass but had no production call
 * site (FABLE-A056, closed 2026-09-08). This static test pins the sites that now use it so they
 * cannot be silently un-wired -- the same source-scanning technique as ChildHomeReadingLevelTest,
 * because this module has no Compose rendering harness.
 */
class MixedDirectionIsolationStaticTest {
    private fun locateMain(relative: String): File {
        val candidates = listOf(File(relative), File("app/$relative"))
        return candidates.firstOrNull { it.exists() }
            ?: error("Could not locate '$relative' from working dir ${File(".").absolutePath}")
    }

    @Test
    fun `the Safe Browser block screen sanitizes and isolates the blocked domain and the reason code`() {
        val text = locateMain("src/main/java/org/pca/app/feature/webprotection/ui/SafeBrowserScreen.kt").readText()
        assertTrue(text.contains("BidiUtils.isolateLtr(BidiUtils.sanitizeBidiControls(decision.domain))"))
        assertTrue(text.contains("BidiUtils.isolateLtr(decision.reasonCode)"))
    }

    @Test
    fun `enrollment key fingerprints are isolated before being embedded in a localized sentence`() {
        val text = locateMain("src/main/java/org/pca/app/enrollment/ui/EnrollmentScreen.kt").readText()
        assertTrue(text.contains("BidiUtils.isolateLtr(fingerprints.signingKeyFingerprint)"))
        assertTrue(text.contains("BidiUtils.isolateLtr(fingerprints.encryptionKeyFingerprint)"))
    }

    @Test
    fun `BidiUtils has production call sites, not only tests`() {
        val mainRoot = locateMain("src/main/java/org/pca/app")
        val callers = mainRoot.walkTopDown()
            .filter { it.isFile && it.extension == "kt" && it.name != "BidiUtils.kt" && it.readText().contains("BidiUtils.isolateLtr(") }
            .map { it.name }
            .toList()
        assertTrue("expected at least 2 production files calling BidiUtils.isolateLtr, found $callers", callers.size >= 2)
    }
}
