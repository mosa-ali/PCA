package org.pca.app.feature.settings.ui

import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Regression guard mirroring [DeleteNowScreenReachabilityTest]'s pattern (PCA-FR-065/103/104):
 * [AuditExportScreen] plus the underlying
 * [org.pca.app.persistence.export.AuditRecordExportService.exportFamily] call it triggers were
 * fully implemented and unit-tested (PCA-FR-124), but had zero call sites in production UI code --
 * a repo-wide search found no settings screen, menu, or ViewModel referencing
 * `auditRecordExportService`, `exportFamily`, or `generateEncryptedExport` anywhere.
 *
 * This is now fixed by wiring [AuditExportScreen] into
 * [org.pca.app.security.ui.AdminSecurityActivity]'s authenticated admin surface -- the same
 * no-shared-NavHost, PIN/biometric-gated pattern already used there for
 * [DeleteNowScreen]/[org.pca.app.feature.removaldecision.ui.RemovalDecisionScreen]. This static
 * check does not require compiling/running an Activity; it fails loudly if the real call site is
 * ever removed without a replacement, catching a silent regression back to orphaned scaffolding.
 */
class AuditExportScreenReachabilityTest {
    @Test
    fun `AuditExportScreen is invoked from at least one real production file, not only from its own declaration or tests`() {
        val mainDir = mainSourceDir()
        val callSitePattern = Regex("""\bAuditExportScreen\(""")
        val declarationFile = File(mainDir, "java/org/pca/app/feature/settings/ui/AuditExportScreen.kt")

        val realCallers = mainDir.walkTopDown()
            .filter { it.isFile && it.extension == "kt" && it.canonicalFile != declarationFile.canonicalFile }
            .filter { file -> file.readLines().any { callSitePattern.containsMatchIn(it) } }
            .toList()

        assertTrue(
            "AuditExportScreen(...) is never called from any production file other than its own declaration -- " +
                "it is orphaned scaffolding again. It must be wired into a real Activity/composable " +
                "(see AdminSecurityActivity for the established pattern).",
            realCallers.isNotEmpty(),
        )
    }

    /**
     * Companion guard: the entry point this screen exists to reach,
     * [org.pca.app.persistence.export.AuditRecordExportService.exportFamily], must itself be
     * called from the same production caller -- otherwise the screen could be wired to a stub
     * and this test would pass while the underlying export never actually runs.
     */
    @Test
    fun `AdminSecurityActivity calls exportFamily, not just the screen composable`() {
        val mainDir = mainSourceDir()
        val callerFile = File(mainDir, "java/org/pca/app/security/ui/AdminSecurityActivity.kt")

        assertTrue(
            "AdminSecurityActivity.kt not found at expected path: ${callerFile.canonicalPath}",
            callerFile.exists(),
        )
        assertTrue(
            "AdminSecurityActivity.kt no longer calls exportFamily(...) -- AuditExportScreen would be wired to " +
                "nothing. It must call org.pca.app.persistence.export.AuditRecordExportService.exportFamily.",
            callerFile.readLines().any { Regex("""\bexportFamily\(""").containsMatchIn(it) },
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
