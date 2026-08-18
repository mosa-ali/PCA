package org.pca.app.runtime.ui

import java.io.File
import org.junit.Assert.assertTrue
import org.junit.Test

class ChildHomeDisclosureStaticTest {
    private fun read(relative: String): String {
        val candidates = listOf(File("src/main/$relative"), File("app/src/main/$relative"))
        return candidates.firstOrNull { it.exists() }?.readText() ?: error("$relative was not found")
    }

    @Test
    fun `child home exposes management visibility and request disclosures in both languages`() {
        val source = read("java/org/pca/app/runtime/ui/ChildHomeScreen.kt")
        val english = read("res/values/runtime_strings.xml")
        val arabic = read("res/values-ar/runtime_strings.xml")

        assertTrue(source.contains("ManagementDisclosureCard"))
        assertTrue(source.contains("ParentVisibilityCard"))
        assertTrue(source.contains("child_home_parent_contact_explanation"))
        assertTrue(english.contains("child_home_parent_visibility_body"))
        assertTrue(english.contains("child_home_management_active"))
        assertTrue(arabic.contains("child_home_parent_visibility_body"))
        assertTrue(arabic.contains("child_home_management_active"))
    }
}
