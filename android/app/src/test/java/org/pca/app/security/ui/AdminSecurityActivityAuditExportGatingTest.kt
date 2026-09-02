package org.pca.app.security.ui

import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Regression guard for a real test-coverage gap found during a targeted mutation-testing pass
 * (final exit-gate closure, following the NOT_STARTED programme): the pre-existing
 * `AuditExportScreenReachabilityTest` only checks that `AuditExportScreen(` and `exportFamily(`
 * appear textually somewhere in production source -- an "is it wired at all" check -- never that
 * the call site sits structurally inside the PIN/biometric `isAuthenticated` gate in
 * [AdminSecurityActivity]. A mutation that hoisted the `AuditExportScreen(...)` call out of the
 * `else` branch (i.e. rendering it before authentication) would still satisfy that existence
 * check.
 *
 * [AdminSecurityActivity] cannot be exercised by a plain JVM unit test (it is a real Android
 * `ComponentActivity`; this project has no Robolectric harness reliable enough for
 * Activity-lifecycle assertions here -- see `AndroidScreenStateObserverTest`'s own documented
 * finding). This mirrors this codebase's established static-source-scan pattern for exactly that
 * class of regression (see `AuditExportScreenReachabilityTest` and `LocalizationKeyParityTests`).
 */
class AdminSecurityActivityAuditExportGatingTest {
    @Test
    fun `AuditExportScreen is only rendered in the isAuthenticated else-branch, never before the PIN-biometric gate`() {
        val source = activitySourceFile().readText()

        val gateStart = source.indexOf("if (!isAuthenticated)")
        assertTrue(
            "AdminSecurityActivity.kt no longer guards this screen with an `if (!isAuthenticated)` " +
                "check -- this test's assumptions are stale.",
            gateStart >= 0,
        )

        val elseStart = source.indexOf("} else {", gateStart)
        assertTrue(
            "AdminSecurityActivity.kt's isAuthenticated check no longer has a matching `} else {` " +
                "branch -- this test's assumptions are stale.",
            elseStart > gateStart,
        )

        val auditExportCallIndex = source.indexOf("AuditExportScreen(")
        assertTrue(
            "AdminSecurityActivity.kt no longer calls AuditExportScreen(...) at all -- this test's " +
                "assumptions are stale (see AuditExportScreenReachabilityTest for the wiring-exists check).",
            auditExportCallIndex >= 0,
        )

        assertTrue(
            "AuditExportScreen(...) must be called INSIDE the isAuthenticated else-branch, never " +
                "before the PIN/biometric gate -- a child (or anyone with the device unlocked) must " +
                "never reach the family audit-export screen without first passing " +
                "AdminPinScreen/biometric verification. Found the call at source offset " +
                "$auditExportCallIndex, which is not after the else-branch starting at $elseStart.",
            auditExportCallIndex > elseStart,
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
