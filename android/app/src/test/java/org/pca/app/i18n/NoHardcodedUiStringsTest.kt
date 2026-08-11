package org.pca.app.i18n

import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * doc 20 Section 2 ("No hard-coded visible product text") / lane brief Section 13
 * (pseudo-localization: "hard-coded strings"). A cheap, static regression guard: any
 * `Text("literal")`/`Text(text = "literal")` call under `feature/` is a product string that
 * bypassed the resource system. This will not catch every possible pattern (e.g. a literal
 * passed through an intermediate variable), but it fails loudly the moment a NEW screen
 * reintroduces the exact mistake this PCA-16 pass just fixed in BreakShieldScreen.kt.
 */
class NoHardcodedUiStringsTest {
    @Test
    fun `no Compose Text() call under the feature directory uses a raw string literal`() {
        val featureDir = featureSourceDir()
        val offenders = mutableListOf<String>()
        val textLiteralPattern = Regex("""\bText\(\s*(text\s*=\s*)?"[^"]""")

        featureDir.walkTopDown().filter { it.isFile && it.extension == "kt" }.forEach { file ->
            file.readLines().forEachIndexed { index, line ->
                if (textLiteralPattern.containsMatchIn(line)) {
                    offenders += "${file.path}:${index + 1}: $line"
                }
            }
        }

        assertTrue("Hard-coded UI text found (must use stringResource/pluralStringResource instead):\n${offenders.joinToString("\n")}", offenders.isEmpty())
    }

    private fun featureSourceDir(): File {
        val candidates = listOf(
            File("src/main/java/org/pca/app/feature"),
            File("android/app/src/main/java/org/pca/app/feature"),
        )
        return candidates.firstOrNull { it.exists() }
            ?: error("Could not locate feature/ source directory from working directory ${File(".").absolutePath}")
    }
}
