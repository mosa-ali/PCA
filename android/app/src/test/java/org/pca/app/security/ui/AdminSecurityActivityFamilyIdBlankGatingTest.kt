package org.pca.app.security.ui

import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Regression guard for FABLE-A050's residual gap: `EnrollmentCoordinator.persistSuccess()`
 * persists `LocalFamilyState.familyId = ""` as an explicitly documented placeholder for the
 * entire pre-pairing window (the bootstrap response carries only deviceId/status, never a real
 * family identifier -- see `EnrollmentCoordinator.kt`'s KNOWN_GAP comment). `familyId` is a
 * non-nullable `String`, so a bare `currentFamilyId != null` check derived from
 * `familyStateStore.currentState()?.familyId` is trivially true for an enrolled-but-unpaired
 * device: it previously rendered working-looking "Delete Now" and "Export Audit Trail" controls
 * that always failed underneath with a generic error (`DeleteNowCoordinator`/
 * `AuditRecordExportService` both `require(familyId.isNotBlank())`), instead of an honest
 * unavailable state -- exactly the condition
 * [org.pca.app.feature.webprotection.identity.WebProtectionIdentityContext] already guards
 * correctly with `.isBlank()` for this same field.
 *
 * [AdminSecurityActivity] cannot be exercised by a plain JVM unit test (see
 * `AdminSecurityActivityAuditExportGatingTest`'s documented reasoning), so this mirrors this
 * codebase's established static-source-scan regression pattern.
 */
class AdminSecurityActivityFamilyIdBlankGatingTest {
    @Test
    fun `currentFamilyId is derived with a blank-aware filter, not a bare null check, before gating Delete Now and Audit Export`() {
        val source = activitySourceFile().readText()

        val declarationIndex = source.indexOf("val currentFamilyId =")
        assertTrue(
            "AdminSecurityActivity.kt no longer declares `val currentFamilyId = ...` -- this " +
                "test's assumptions are stale.",
            declarationIndex >= 0,
        )

        // The declaration statement runs from `val currentFamilyId =` up to the next top-level
        // `if (` that consumes it (the Delete Now gate). Everything in between is the derivation
        // expression, which must reject a blank (not just null) familyId.
        val nextIfIndex = source.indexOf("if (enrolledIdentity != null && currentFamilyId != null)", declarationIndex)
        assertTrue(
            "AdminSecurityActivity.kt's Delete Now gate (`if (enrolledIdentity != null && " +
                "currentFamilyId != null)`) was not found after the currentFamilyId declaration -- " +
                "this test's assumptions are stale.",
            nextIfIndex > declarationIndex,
        )

        val derivation = source.substring(declarationIndex, nextIfIndex)
        val isBlankAware = derivation.contains("isNotBlank") || derivation.contains("isNullOrBlank")
        assertTrue(
            "currentFamilyId must be derived with a blank-aware filter (e.g. " +
                "`?.takeIf { it.isNotBlank() }`, mirroring WebProtectionIdentityContext's " +
                "`.isBlank()` guard on this exact field) before the Delete Now / Audit Export " +
                "gates below it -- a bare `?.familyId` (or `!= null` check alone) is trivially " +
                "true for an enrolled-but-unpaired device whose familyId is the documented \"\" " +
                "placeholder, silently re-opening FABLE-A050's UI-honesty gap. Found derivation: " +
                derivation.trim(),
            isBlankAware,
        )

        // The Audit Export gate must reuse the same already-filtered currentFamilyId, not
        // re-derive its own unfiltered `!= null` check.
        val auditGateIndex = source.indexOf("if (currentFamilyId != null)", nextIfIndex)
        assertTrue(
            "AdminSecurityActivity.kt's Audit Export gate (`if (currentFamilyId != null)`) was " +
                "not found reusing the same currentFamilyId as the Delete Now gate -- this test's " +
                "assumptions are stale.",
            auditGateIndex > nextIfIndex,
        )
    }

    private fun activitySourceFile(): File {
        val candidates = listOf(
            File("src/main/java/org/pca/app/security/ui/AdminSecurityActivity.kt"),
            File("android/app/src/main/java/org/pca/app/security/ui/AdminSecurityActivity.kt"),
        )
        return candidates.firstOrNull { it.exists() }
            ?: error("Could not locate AdminSecurityActivity.kt from working directory ${File(".").absolutePath}")
    }
}
