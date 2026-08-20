package org.pca.app.enrollment

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * PCA-NFR-044: mirrors ios/PCATests/EnrollmentProfileTests.swift's
 * `testYoungChildDisclosureUsesShorterConfirmationCopyWithoutChangingPrivacyScope` --
 * `XCTAssertEqual(young.readingLevel, .simple)` / `XCTAssertEqual(teen.readingLevel, .clear)` --
 * adapted to this module's [AgeUxTier] / [ReadingLevel] shapes.
 */
class EnrollmentReadingLevelTest {
    @Test
    fun `young child tier resolves to the simple reading level`() {
        assertEquals(ReadingLevel.SIMPLE, AgeUxTier.YOUNG_CHILD.readingLevel)
    }

    @Test
    fun `teen tier resolves to the clear reading level`() {
        assertEquals(ReadingLevel.CLEAR, AgeUxTier.TEEN.readingLevel)
    }

    // -- Static, source-scanning proof (same technique as EnrollmentConsentStaticTest) that the
    // disclosure UI actually branches per tier at render time instead of hardcoding one variant:
    // this module has no Robolectric/instrumented Compose test harness, so a plain string
    // resource ID equality check on the un-rendered `stringResource` call isn't possible here. --

    private fun locateMainDir(relative: String): File {
        val candidates = listOf(File(relative), File("app/$relative"))
        return candidates.firstOrNull { it.exists() }
            ?: error("Could not locate '$relative' from working dir ${File(".").absolutePath}")
    }

    @Test
    fun `the enrollment screen selects the reading-level string set per age tier instead of hardcoding one variant`() {
        val text = locateMainDir("src/main/java/org/pca/app/enrollment/ui/EnrollmentScreen.kt").readText()
        assertTrue(text.contains("disclosureCopyForTier(state.ageUxTier)"))
        assertTrue(text.contains("AgeUxTier.YOUNG_CHILD -> EnrollmentDisclosureCopy("))
        assertTrue(text.contains("AgeUxTier.TEEN -> EnrollmentDisclosureCopy("))
        assertTrue(text.contains("R.string.enrollment_profile_confirmation_title_simple"))
        assertTrue(text.contains("R.string.enrollment_profile_confirmation_body_simple"))
        assertTrue(text.contains("R.string.enrollment_profile_confirmation_button_simple"))
    }

    @Test
    fun `the simple and clear string variants are genuinely distinct resource keys`() {
        val text = locateMainDir("src/main/res/values/strings.xml").readText()
        assertTrue(text.contains("enrollment_profile_confirmation_title_simple"))
        assertTrue(text.contains("enrollment_profile_confirmation_body_simple"))
        assertTrue(text.contains("enrollment_profile_confirmation_button_simple"))
        // The pre-existing keys (teen/"clear" tier copy) must remain untouched.
        assertTrue(text.contains("enrollment_profile_confirmation_title\">Confirm your protection profile"))
        assertTrue(text.contains("enrollment_profile_confirmation_button\">Confirm this profile"))
    }
}
