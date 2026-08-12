package org.pca.app.runtime.ui

import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Section 19: "Add runtime-shell strings in EN/AR." A cheap static guard, same idea as
 * `i18n/NoHardcodedUiStringsTest.kt` -- every key defined in the English `runtime_strings.xml`
 * must have a matching key in the Arabic file, and vice versa, so a future edit can never ship
 * with one locale silently missing a string (which would fall back to English inside an
 * otherwise-Arabic screen).
 */
class RuntimeStringsParityTest {

    @Test
    fun `every English runtime_strings key has a matching Arabic key, and vice versa`() {
        val en = stringKeys(resFile("values/runtime_strings.xml"))
        val ar = stringKeys(resFile("values-ar/runtime_strings.xml"))

        val missingFromAr = en - ar
        val missingFromEn = ar - en

        assertTrue("Keys present in EN but missing from AR: $missingFromAr", missingFromAr.isEmpty())
        assertTrue("Keys present in AR but missing from EN: $missingFromEn", missingFromEn.isEmpty())
        assertTrue("No keys found -- resource file likely missing/misread", en.isNotEmpty())
    }

    private fun stringKeys(file: File): Set<String> {
        val pattern = Regex("""<string\s+name="([^"]+)"""")
        return pattern.findAll(file.readText()).map { it.groupValues[1] }.toSet()
    }

    private fun resFile(relative: String): File {
        val candidates = listOf(
            File("src/main/res/$relative"),
            File("android/app/src/main/res/$relative"),
        )
        return candidates.firstOrNull { it.exists() }
            ?: error("Could not locate res/$relative from working directory ${File(".").absolutePath}")
    }
}
