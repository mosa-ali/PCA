package org.pca.app.security.ui

import java.io.File
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * PCA-NFR-044: closes the documented "known residual gap" (matrix note on this requirement) that
 * AdminPinScreen -- the PIN-entry surface a child can reach via ChildHomeScreen's
 * AdminSecurityEntryCard -- had no reading-level-differentiated copy. Mirrors
 * org.pca.app.feature.breakshield.BreakShieldReadingLevelTest's static, source-scanning
 * technique -- this module has no Robolectric/instrumented Compose test harness, so a plain
 * string-resource-ID equality check on the un-rendered `stringResource` call isn't possible here.
 */
class AdminPinReadingLevelTest {
    private fun locateMainDir(relative: String): File {
        val candidates = listOf(File(relative), File("app/$relative"))
        return candidates.firstOrNull { it.exists() }
            ?: error("Could not locate '$relative' from working dir ${File(".").absolutePath}")
    }

    private fun screenText() =
        locateMainDir("src/main/java/org/pca/app/security/ui/AdminPinScreen.kt").readText()

    @Test
    fun `the admin pin screen selects the reading-level string set per age tier instead of hardcoding one variant`() {
        val text = screenText()
        assertTrue(text.contains("adminPinCopyForTier(resolvedAgeUxTier)"))
        assertTrue(text.contains("AgeUxTier.YOUNG_CHILD -> AdminPinCopy("))
        assertTrue(text.contains("AgeUxTier.TEEN -> AdminPinCopy("))
        assertTrue(text.contains("R.string.admin_pin_setup_title_simple"))
        assertTrue(text.contains("R.string.admin_pin_change_title_simple"))
        assertTrue(text.contains("R.string.admin_pin_verify_title_simple"))
        assertTrue(text.contains("R.string.admin_pin_confirm_field_label_simple"))
        assertTrue(text.contains("R.string.admin_pin_confirm_button_simple"))
        assertTrue(text.contains("R.string.admin_pin_continue_button_simple"))
        assertTrue(text.contains("R.string.admin_pin_save_button_simple"))
        assertTrue(text.contains("R.string.admin_pin_incorrect_message_simple"))
        assertTrue(text.contains("R.string.admin_pin_locked_out_message_simple"))
    }

    @Test
    fun `the admin pin screen resolves the real persisted age tier instead of a hardcoded default`() {
        val text = screenText()
        assertTrue(text.contains("resolveDeviceAgeUxTier()"))
        assertTrue(text.contains(".graph"))
        assertTrue(text.contains(".familyStateStore"))
        assertTrue(text.contains(".currentState()"))
        assertTrue(text.contains("?.ageUxTier"))
    }

    @Test
    fun `the incorrect-PIN error message is resource-driven and tier-aware, not hardcoded English`() {
        val screen = screenText()
        assertTrue(screen.contains("copy.incorrectPinMessageRes"))
        assertTrue(screen.contains("hasIncorrectPinError"))

        val activity = locateMainDir("src/main/java/org/pca/app/security/ui/AdminSecurityActivity.kt").readText()
        assertFalse("AdminSecurityActivity.kt must no longer hardcode the error string", activity.contains("\"Incorrect PIN\""))
        assertTrue(activity.contains("hasIncorrectPinError = pinHasIncorrectError"))
    }

    @Test
    fun `the simple and clear tier resource keys are genuinely distinct, never the same key reused`() {
        val text = locateMainDir("src/main/res/values/strings.xml").readText()
        assertTrue(text.contains("admin_pin_setup_title_simple\">"))
        assertTrue(text.contains("admin_pin_change_title_simple\">"))
        assertTrue(text.contains("admin_pin_verify_title_simple\">"))
        assertTrue(text.contains("admin_pin_incorrect_message\">"))
        assertTrue(text.contains("admin_pin_incorrect_message_simple\">"))
        assertTrue(text.contains("admin_pin_locked_out_message\">"))
        assertTrue(text.contains("admin_pin_locked_out_message_simple\">"))

        val clearIncorrect = Regex("""admin_pin_incorrect_message">([^<]*)<""").find(text)!!.groupValues[1]
        val simpleIncorrect = Regex("""admin_pin_incorrect_message_simple">([^<]*)<""").find(text)!!.groupValues[1]
        assertTrue("the simple variant must actually differ from the clear variant", clearIncorrect != simpleIncorrect)

        // The pre-existing (teen/"clear" tier) keys must remain untouched.
        assertTrue(text.contains("admin_pin_setup_title\">Set an admin PIN"))
        assertTrue(text.contains("admin_pin_verify_title\">Enter admin PIN"))
    }
}
