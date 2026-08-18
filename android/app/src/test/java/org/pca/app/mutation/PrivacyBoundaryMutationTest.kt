package org.pca.app.mutation

import java.io.File
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * CURRENT_HEAD_MUTATION static boundaries for PCA-NFR-014, PCA-NFR-060, and
 * PCA-NFR-051. The mutation runner evaluates equivalent source copies with
 * the same assertions; production Android source is never edited in place.
 */
class PrivacyBoundaryMutationTest {
    private fun root(): File = System.getenv("PCA_MUTATION_ANDROID_ROOT")?.let(::File)
        ?: File(".").canonicalFile

    private fun read(relative: String): String {
        val candidates = listOf(
            File(root(), relative),
            File(root(), relative.removePrefix("app/")),
        )
        return candidates.firstOrNull { it.isFile }?.readText()
            ?: error("$relative was not found below ${root().absolutePath}")
    }

    @Test
    fun `child disclosure is present in both supported languages`() {
        val screen = read("app/src/main/java/org/pca/app/runtime/ui/ChildHomeScreen.kt")
        val english = read("app/src/main/res/values/runtime_strings.xml")
        val arabic = read("app/src/main/res/values-ar/runtime_strings.xml")
        assertTrue(screen.contains("ManagementDisclosureCard"))
        assertTrue(screen.contains("ParentVisibilityCard"))
        assertTrue(english.contains("child_home_parent_visibility_body"))
        assertTrue(english.contains("child_home_management_active"))
        assertTrue(arabic.contains("child_home_parent_visibility_body"))
        assertTrue(arabic.contains("child_home_management_active"))
    }

    @Test
    fun `web protection has a visible foreground notification and DNS-only route`() {
        val source = read("app/src/main/java/org/pca/app/feature/webprotection/vpn/WebProtectionVpnService.kt")
        assertTrue(source.contains("startForeground("))
        assertTrue(source.contains(".setOngoing(true)"))
        assertTrue(source.contains(".addRoute(TUNNEL_DNS_ADDRESS, 32)"))
        assertFalse(source.contains(".addRoute(\"0.0.0.0\", 0)"))
    }

    @Test
    fun `wellbeing export boundary is aggregate-only and has no direct telemetry transport`() {
        val source = read("app/src/main/java/org/pca/app/feature/wellbeing/ports/WellbeingFeedbackSyncPort.kt")
        assertTrue(source.contains("NudgeAggregateSummary"))
        assertTrue(source.contains("exportAggregateSummary"))
        assertFalse(source.contains("android.util.Log"))
        assertFalse(source.contains("println("))
        assertFalse(source.contains("sendBeacon"))
        assertFalse(source.contains("HttpURLConnection"))
        assertFalse(source.contains("OkHttpClient"))
        assertFalse(source.contains("telemetry", ignoreCase = true))
    }
}
