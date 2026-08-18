package org.pca.app.i18n

import java.io.File
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Keeps child-facing monitoring disclosure copy distinct from internal/account
 * family terminology. This is a source-level guard for the two shipped locales.
 */
class MonitoredFamilyTerminologyTest {
    @Test
    fun `child home disclosure names device activity without family monitoring wording`() {
        val english = read("res/values/runtime_strings.xml")
        val arabic = read("res/values-ar/runtime_strings.xml")

        assertTrue(english.contains("activity categories enabled for your device"))
        assertTrue(english.contains("children\\'s monitoring history"))
        assertFalse(english.contains("family-enabled activity categories"))
        assertFalse(english.contains("family monitoring history"))

        assertTrue(arabic.contains("فئات النشاط المفعّلة على جهازك"))
        assertTrue(arabic.contains("سجل لمراقبة نشاط الأطفال"))
        assertFalse(arabic.contains("تتيحها العائلة"))
        assertFalse(arabic.contains("سجل مراقبة عائلي"))
    }

    private fun read(relative: String): String {
        val candidates = listOf(File("src/main/$relative"), File("app/src/main/$relative"))
        return candidates.firstOrNull { it.isFile }?.readText()
            ?: error("$relative was not found")
    }
}
