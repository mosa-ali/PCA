package org.pca.app.feature.webprotection.ui

import java.io.File
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * PCA-NFR-044: closes the documented gap that the Safe Browser child block screen (the
 * `HeldPage` composable in SafeBrowserScreen.kt) had no reading-level-differentiated copy.
 * Mirrors org.pca.app.enrollment.EnrollmentReadingLevelTest's static, source-scanning technique --
 * this module has no Robolectric/instrumented Compose test harness, so a plain
 * string-resource-ID equality check on the un-rendered `stringResource` call isn't possible here.
 */
class SafeBrowserReadingLevelTest {
    private fun locateMainDir(relative: String): File {
        val candidates = listOf(File(relative), File("app/$relative"))
        return candidates.firstOrNull { it.exists() }
            ?: error("Could not locate '$relative' from working dir ${File(".").absolutePath}")
    }

    @Test
    fun `the safe browser held page selects the reading-level string set per age tier instead of hardcoding one variant`() {
        val text = locateMainDir("src/main/java/org/pca/app/feature/webprotection/ui/SafeBrowserScreen.kt").readText()
        assertTrue(text.contains("safeBrowserHeldCopyForTier(ageUxTier, isReview = decision.outcome == WebDecisionOutcome.REVIEW)"))
        assertTrue(text.contains("AgeUxTier.YOUNG_CHILD -> SafeBrowserHeldCopy("))
        assertTrue(text.contains("AgeUxTier.TEEN -> SafeBrowserHeldCopy("))
        assertTrue(text.contains("R.string.safe_browser_held_block_title_simple"))
        assertTrue(text.contains("R.string.safe_browser_held_review_title_simple"))
        assertTrue(text.contains("R.string.safe_browser_held_explanation_block_simple"))
        assertTrue(text.contains("R.string.safe_browser_held_explanation_review_simple"))
        assertTrue(text.contains("R.string.safe_browser_ask_parent_button_simple"))
    }

    @Test
    fun `the safe browser screen resolves the real persisted age tier instead of a hardcoded default`() {
        val text = locateMainDir("src/main/java/org/pca/app/feature/webprotection/ui/SafeBrowserScreen.kt").readText()
        assertTrue(text.contains("resolveDeviceAgeUxTier()"))
        assertTrue(text.contains(".graph"))
        assertTrue(text.contains(".familyStateStore"))
        assertTrue(text.contains(".currentState()"))
        assertTrue(text.contains("?.ageUxTier"))
    }

    @Test
    fun `block-reason and ask-a-parent substance is present for both reading levels, never weakened for the simple tier`() {
        val text = locateMainDir("src/main/res/values/strings.xml").readText()
        val blockClear = Regex("""safe_browser_held_explanation_block">([^<]*)<""").find(text)!!.groupValues[1]
        val blockSimple = Regex("""safe_browser_held_explanation_block_simple">([^<]*)<""").find(text)!!.groupValues[1]
        val reviewClear = Regex("""safe_browser_held_explanation_review">([^<]*)<""").find(text)!!.groupValues[1]
        val reviewSimple = Regex("""safe_browser_held_explanation_review_simple">([^<]*)<""").find(text)!!.groupValues[1]
        listOf(blockClear, blockSimple, reviewClear, reviewSimple).forEach { copy ->
            assertTrue("expected parent-ask substance in: $copy", copy.contains("parent", ignoreCase = true))
        }
    }

    @Test
    fun `the simple and clear string variants are genuinely distinct resource keys`() {
        val text = locateMainDir("src/main/res/values/strings.xml").readText()
        assertTrue(text.contains("safe_browser_held_block_title_simple"))
        assertTrue(text.contains("safe_browser_held_review_title_simple"))
        assertTrue(text.contains("safe_browser_ask_parent_button_simple"))
        // The pre-existing keys (teen/"clear" tier copy) must remain untouched.
        assertTrue(text.contains("safe_browser_held_block_title\">This site is blocked"))
        assertTrue(text.contains("safe_browser_held_review_title\">This site needs a parent"))
    }
}
