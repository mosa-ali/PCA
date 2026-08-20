package org.pca.app.runtime.ui

import java.io.File
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * PCA-NFR-044: closes the documented gap that ChildHomeScreen had no reading-level-differentiated
 * copy. Mirrors org.pca.app.enrollment.EnrollmentReadingLevelTest's static, source-scanning
 * technique -- this module has no Robolectric/instrumented Compose test harness, so a plain
 * string-resource-ID equality check on the un-rendered `stringResource` call isn't possible here.
 */
class ChildHomeReadingLevelTest {
    private fun locateMainDir(relative: String): File {
        val candidates = listOf(File(relative), File("app/$relative"))
        return candidates.firstOrNull { it.exists() }
            ?: error("Could not locate '$relative' from working dir ${File(".").absolutePath}")
    }

    @Test
    fun `the child home screen selects the reading-level string set per age tier instead of hardcoding one variant`() {
        val text = locateMainDir("src/main/java/org/pca/app/runtime/ui/ChildHomeScreen.kt").readText()
        assertTrue(text.contains("childHomeCopyForTier(resolvedAgeUxTier)"))
        assertTrue(text.contains("AgeUxTier.YOUNG_CHILD -> ChildHomeCopy("))
        assertTrue(text.contains("AgeUxTier.TEEN -> ChildHomeCopy("))
        assertTrue(text.contains("R.string.child_home_title_simple"))
        assertTrue(text.contains("R.string.child_home_parent_visibility_title_simple"))
        assertTrue(text.contains("R.string.child_home_parent_visibility_body_simple"))
        assertTrue(text.contains("R.string.child_home_safe_browser_simple"))
        assertTrue(text.contains("R.string.child_home_emergency_access_simple"))
        assertTrue(text.contains("R.string.child_home_emergency_access_active_simple"))
        assertTrue(text.contains("R.string.child_home_emergency_access_exit_simple"))
    }

    @Test
    fun `the child home screen resolves the real persisted age tier instead of a hardcoded default`() {
        val text = locateMainDir("src/main/java/org/pca/app/runtime/ui/ChildHomeScreen.kt").readText()
        assertTrue(text.contains("resolveDeviceAgeUxTier()"))
        assertTrue(text.contains(".graph"))
        assertTrue(text.contains(".familyStateStore"))
        assertTrue(text.contains(".currentState()"))
        assertTrue(text.contains("?.ageUxTier"))
    }

    @Test
    fun `the simple and clear runtime_strings variants are genuinely distinct resource keys`() {
        val text = locateMainDir("src/main/res/values/runtime_strings.xml").readText()
        assertTrue(text.contains("child_home_title_simple"))
        assertTrue(text.contains("child_home_parent_visibility_title_simple"))
        assertTrue(text.contains("child_home_parent_visibility_body_simple"))
        assertTrue(text.contains("child_home_emergency_access_simple"))
        assertTrue(text.contains("child_home_emergency_access_active_simple"))
        assertTrue(text.contains("child_home_emergency_access_exit_simple"))
        // The pre-existing keys (teen/"clear" tier copy) must remain untouched.
        assertTrue(text.contains("child_home_title\">Protection status"))
        assertTrue(text.contains("child_home_emergency_access\">Emergency access"))
    }

    @Test
    fun `the simple safe browser entry variant is a genuinely distinct resource key`() {
        val text = locateMainDir("src/main/res/values/strings.xml").readText()
        assertTrue(text.contains("child_home_safe_browser_simple"))
        assertTrue(text.contains("child_home_safe_browser\">Safe Browser"))
    }
}
