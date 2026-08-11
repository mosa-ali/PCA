package org.pca.app.i18n

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import javax.xml.parsers.DocumentBuilderFactory

/**
 * doc 20 Section 2/lane brief Section 17: "Missing Arabic is a release defect... Do not treat
 * fallback as completion." This test is the detectable, automated release-quality failure that
 * makes a missing Arabic string impossible to ship silently: it parses both locale resource
 * files directly (no Android runtime/Robolectric needed -- `<string>`/`<plurals>` are plain XML)
 * and fails the build the moment their key sets diverge in EITHER direction (an English string
 * added without Arabic, or vice versa).
 */
class StringResourceCompletenessTest {
    @Test
    fun `every English string-resource key has a matching Arabic key and vice versa`() {
        val englishKeys = resourceKeys(localeStringsFile("values"))
        val arabicKeys = resourceKeys(localeStringsFile("values-ar"))

        assertTrue("English strings.xml unexpectedly declared zero keys", englishKeys.isNotEmpty())

        val missingInArabic = englishKeys - arabicKeys
        val missingInEnglish = arabicKeys - englishKeys
        assertTrue(
            "Missing Arabic translations for: $missingInArabic (this is a release defect, not an acceptable fallback)",
            missingInArabic.isEmpty(),
        )
        assertTrue("values-ar declares keys with no English source: $missingInEnglish", missingInEnglish.isEmpty())
        assertEquals(englishKeys, arabicKeys)
    }

    @Test
    fun `no Arabic string resource value is empty`() {
        val doc = parseXml(localeStringsFile("values-ar"))
        val stringNodes = doc.getElementsByTagName("string")
        for (i in 0 until stringNodes.length) {
            val node = stringNodes.item(i)
            val name = node.attributes.getNamedItem("name")?.nodeValue
            assertTrue("values-ar string '$name' is empty", (node.textContent ?: "").isNotBlank())
        }
    }

    private fun resourceKeys(file: File): Set<String> {
        val doc = parseXml(file)
        val keys = mutableSetOf<String>()
        for (tag in listOf("string", "plurals")) {
            val nodes = doc.getElementsByTagName(tag)
            for (i in 0 until nodes.length) {
                keys += nodes.item(i).attributes.getNamedItem("name").nodeValue
            }
        }
        return keys
    }

    private fun parseXml(file: File) =
        DocumentBuilderFactory.newInstance().newDocumentBuilder().parse(file).also { it.documentElement.normalize() }

    /** Gradle unit tests run with the module directory (android/app) as the working directory. */
    private fun localeStringsFile(valuesDir: String): File {
        val candidates = listOf(
            File("src/main/res/$valuesDir/strings.xml"),
            File("android/app/src/main/res/$valuesDir/strings.xml"),
        )
        return candidates.firstOrNull { it.exists() }
            ?: error("Could not locate $valuesDir/strings.xml from working directory ${File(".").absolutePath}")
    }
}
