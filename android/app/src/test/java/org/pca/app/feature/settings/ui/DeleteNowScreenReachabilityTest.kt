package org.pca.app.feature.settings.ui

import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Regression guard for a real defect found by an independent completeness audit
 * (PCA-FR-065/103/104): [DeleteNowScreen] was fully built -- real composable, real
 * [org.pca.app.feature.settings.data.DeleteNowUseCase]/[org.pca.app.persistence.retention.DeleteNowCoordinator]
 * wiring underneath it, localized strings, and focused unit tests for the use case and
 * coordinator -- but the screen's own `@Composable fun DeleteNowScreen(...)` was never
 * actually called from any Activity or other real production composable. The matrix had
 * recorded "Runtime reachability: YES" for this exact evidence, which was not true: a repo-wide
 * search found zero call sites outside the file's own declaration.
 *
 * This is now fixed by wiring [DeleteNowScreen] into [org.pca.app.security.ui.AdminSecurityActivity]'s
 * authenticated admin surface (the same no-shared-NavHost pattern already used there for
 * [org.pca.app.feature.removaldecision.ui.RemovalDecisionScreen] and the eye-distance permission
 * entry point). This static check does not require compiling/running an Activity; it fails loudly
 * if the real call site is ever removed without a replacement, catching a silent regression back
 * to orphaned scaffolding.
 */
class DeleteNowScreenReachabilityTest {
    @Test
    fun `DeleteNowScreen is invoked from at least one real production file, not only from its own declaration or tests`() {
        val mainDir = mainSourceDir()
        val callSitePattern = Regex("""\bDeleteNowScreen\(""")
        val declarationFile = File(mainDir, "java/org/pca/app/feature/settings/ui/DeleteNowScreen.kt")

        val realCallers = mainDir.walkTopDown()
            .filter { it.isFile && it.extension == "kt" && it.canonicalFile != declarationFile.canonicalFile }
            .filter { file -> file.readLines().any { callSitePattern.containsMatchIn(it) } }
            .toList()

        assertTrue(
            "DeleteNowScreen(...) is never called from any production file other than its own declaration -- " +
                "it is orphaned scaffolding again. It must be wired into a real Activity/composable " +
                "(see AdminSecurityActivity for the established pattern).",
            realCallers.isNotEmpty(),
        )
    }

    private fun mainSourceDir(): File {
        val candidates = listOf(
            File("src/main"),
            File("android/app/src/main"),
        )
        return candidates.firstOrNull { it.exists() }
            ?: error("Could not locate src/main directory from working directory ${File(".").absolutePath}")
    }
}
