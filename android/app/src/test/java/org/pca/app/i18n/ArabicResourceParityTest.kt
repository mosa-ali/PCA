package org.pca.app.i18n

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * PCA-FR-114: every Android string and plural resource must have an Arabic
 * counterpart so the Arabic locale never silently falls back to English for
 * a newly added user-facing key.
 */
class ArabicResourceParityTest {
    private val resourceName = Regex("<(?:string|plurals)\\s+name=\"([^\"]+)\"")

    @Test
    fun `Arabic resources contain exactly the default resource key set`() {
        val defaultKeys = resourceKeys("values/strings.xml")
        val arabicKeys = resourceKeys("values-ar/strings.xml")

        assertEquals("Arabic resource keys must match the default key set", defaultKeys, arabicKeys)
    }

    private fun resourceKeys(relativePath: String): Set<String> {
        val candidates = listOf(
            File("src/main/res/$relativePath"),
            File("app/src/main/res/$relativePath"),
        )
        val file = candidates.firstOrNull { it.isFile }
            ?: error("Could not locate Android resource $relativePath from ${File(".").absolutePath}")
        return resourceName.findAll(file.readText()).map { it.groupValues[1] }.toSet()
    }
}
