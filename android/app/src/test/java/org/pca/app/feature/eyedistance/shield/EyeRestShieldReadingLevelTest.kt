package org.pca.app.feature.eyedistance.shield

import java.io.File
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * PCA-NFR-044: closes the documented gap that EyeRestShieldScreen shipped only a single
 * hardcoded SIMPLE-tier copy variant. Mirrors
 * org.pca.app.feature.breakshield.BreakShieldReadingLevelTest's static, source-scanning
 * technique -- this module has no Robolectric/instrumented Compose test harness, so a plain
 * string-resource-ID equality check on the un-rendered `stringResource` call isn't possible here.
 */
class EyeRestShieldReadingLevelTest {
    private fun locateMainDir(relative: String): File {
        val candidates = listOf(File(relative), File("app/$relative"))
        return candidates.firstOrNull { it.exists() }
            ?: error("Could not locate '$relative' from working dir ${File(".").absolutePath}")
    }

    @Test
    fun `the eye rest shield screen selects the reading-level string set per age tier instead of hardcoding one variant`() {
        val text = locateMainDir(
            "src/main/java/org/pca/app/feature/eyedistance/shield/EyeRestShieldScreen.kt",
        ).readText()
        assertTrue(text.contains("eyeRestShieldCopyForTier(resolvedAgeUxTier)"))
        assertTrue(text.contains("AgeUxTier.YOUNG_CHILD -> EyeRestShieldCopy("))
        assertTrue(text.contains("AgeUxTier.TEEN -> EyeRestShieldCopy("))
        assertTrue(text.contains("R.string.eye_rest_shield_body_simple"))
        assertTrue(text.contains("R.string.eye_rest_shield_remaining_time_simple"))
        assertTrue(text.contains("R.string.eye_rest_shield_remaining_time_a11y_simple"))
        assertTrue(text.contains("R.string.eye_rest_shield_completed_notice_simple"))
    }

    @Test
    fun `the eye rest shield screen resolves the real persisted age tier instead of a hardcoded default`() {
        val text = locateMainDir(
            "src/main/java/org/pca/app/feature/eyedistance/shield/EyeRestShieldScreen.kt",
        ).readText()
        assertTrue(text.contains("resolveDeviceAgeUxTier()"))
        assertTrue(text.contains(".graph"))
        assertTrue(text.contains(".familyStateStore"))
        assertTrue(text.contains(".currentState()"))
        assertTrue(text.contains("?.ageUxTier"))
    }

    @Test
    fun `both reading levels are genuinely distinct resource keys and neither drops the rest substance`() {
        val text = locateMainDir("src/main/res/values/strings.xml").readText()
        assertTrue(text.contains("eye_rest_shield_body\">"))
        assertTrue(text.contains("eye_rest_shield_body_simple\">"))
        assertTrue(text.contains("eye_rest_shield_remaining_time\">"))
        assertTrue(text.contains("eye_rest_shield_remaining_time_simple\">"))
        assertTrue(text.contains("eye_rest_shield_remaining_time_a11y\">"))
        assertTrue(text.contains("eye_rest_shield_remaining_time_a11y_simple\">"))
        assertTrue(text.contains("eye_rest_shield_completed_notice\">"))
        assertTrue(text.contains("eye_rest_shield_completed_notice_simple\">"))
        // Both variants must describe the eyes/screen rest -- never dropped for the simpler tier.
        val clearBody = Regex("""eye_rest_shield_body">([^<]*)<""").find(text)!!.groupValues[1]
        val simpleBody = Regex("""eye_rest_shield_body_simple">([^<]*)<""").find(text)!!.groupValues[1]
        assertTrue(clearBody.contains("rest", ignoreCase = true))
        assertTrue(simpleBody.contains("look away", ignoreCase = true))
    }

    @Test
    fun `the arabic locale carries matching simple and clear tier keys`() {
        val text = locateMainDir("src/main/res/values-ar/strings.xml").readText()
        assertTrue(text.contains("eye_rest_shield_body\">"))
        assertTrue(text.contains("eye_rest_shield_body_simple\">"))
        assertTrue(text.contains("eye_rest_shield_remaining_time\">"))
        assertTrue(text.contains("eye_rest_shield_remaining_time_simple\">"))
        assertTrue(text.contains("eye_rest_shield_remaining_time_a11y\">"))
        assertTrue(text.contains("eye_rest_shield_remaining_time_a11y_simple\">"))
        assertTrue(text.contains("eye_rest_shield_completed_notice\">"))
        assertTrue(text.contains("eye_rest_shield_completed_notice_simple\">"))
    }
}
