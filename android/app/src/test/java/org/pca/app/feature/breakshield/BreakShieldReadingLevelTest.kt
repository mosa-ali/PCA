package org.pca.app.feature.breakshield

import java.io.File
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * PCA-NFR-044: closes the documented gap that BreakShieldScreen had no reading-level-
 * differentiated copy. Mirrors org.pca.app.enrollment.EnrollmentReadingLevelTest's static,
 * source-scanning technique -- this module has no Robolectric/instrumented Compose test harness,
 * so a plain string-resource-ID equality check on the un-rendered `stringResource` call isn't
 * possible here.
 */
class BreakShieldReadingLevelTest {
    private fun locateMainDir(relative: String): File {
        val candidates = listOf(File(relative), File("app/$relative"))
        return candidates.firstOrNull { it.exists() }
            ?: error("Could not locate '$relative' from working dir ${File(".").absolutePath}")
    }

    @Test
    fun `the break shield screen selects the reading-level string set per age tier instead of hardcoding one variant`() {
        val text = locateMainDir("src/main/java/org/pca/app/feature/breakshield/BreakShieldScreen.kt").readText()
        assertTrue(text.contains("breakShieldCopyForTier(resolvedAgeUxTier)"))
        assertTrue(text.contains("AgeUxTier.YOUNG_CHILD -> BreakShieldCopy("))
        assertTrue(text.contains("AgeUxTier.TEEN -> BreakShieldCopy("))
        assertTrue(text.contains("R.string.break_shield_explanation_simple"))
        assertTrue(text.contains("R.string.dhikr_button_label_simple"))
        assertTrue(text.contains("R.string.ask_parent_button_label_simple"))
        assertTrue(text.contains("R.string.emergency_button_label_simple"))
        assertTrue(text.contains("R.string.emergency_call_button_label_simple"))
    }

    @Test
    fun `the break shield screen resolves the real persisted age tier instead of a hardcoded default`() {
        val text = locateMainDir("src/main/java/org/pca/app/feature/breakshield/BreakShieldScreen.kt").readText()
        assertTrue(text.contains("resolveDeviceAgeUxTier()"))
        assertTrue(text.contains(".graph"))
        assertTrue(text.contains(".familyStateStore"))
        assertTrue(text.contains(".currentState()"))
        assertTrue(text.contains("?.ageUxTier"))
    }

    @Test
    fun `emergency access substance is present for both reading levels, never weakened for the simple tier`() {
        val text = locateMainDir("src/main/res/values/strings.xml").readText()
        assertTrue(text.contains("break_shield_explanation\">"))
        assertTrue(text.contains("break_shield_explanation_simple\">"))
        // Both variants must mention emergency access -- never dropped for the simpler tier.
        val clearExplanation = Regex("""break_shield_explanation">([^<]*)<""").find(text)!!.groupValues[1]
        val simpleExplanation = Regex("""break_shield_explanation_simple">([^<]*)<""").find(text)!!.groupValues[1]
        assertTrue(clearExplanation.contains("emergency", ignoreCase = true))
        assertTrue(simpleExplanation.contains("emergency", ignoreCase = true))
    }

    @Test
    fun `the simple and clear button label variants are genuinely distinct resource keys`() {
        val text = locateMainDir("src/main/res/values/strings.xml").readText()
        assertTrue(text.contains("dhikr_button_label_simple"))
        assertTrue(text.contains("ask_parent_button_label_simple"))
        assertTrue(text.contains("emergency_button_label_simple"))
        assertTrue(text.contains("emergency_call_button_label_simple"))
        // The pre-existing keys (teen/"clear" tier copy) must remain untouched.
        assertTrue(text.contains("dhikr_button_label\">Dhikr / Remembrance"))
        assertTrue(text.contains("emergency_button_label\">Emergency<"))
    }
}
