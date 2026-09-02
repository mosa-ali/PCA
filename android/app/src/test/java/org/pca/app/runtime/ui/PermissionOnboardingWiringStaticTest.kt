package org.pca.app.runtime.ui

import java.io.File
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The regression guard for the actual defect the two onboarding policies close: not "does a policy
 * object exist" (their own unit tests cover that) but "is it reachable from a real user-visible
 * control, and does the hand-off it decides on actually happen".
 *
 * Both permissions were declared in `AndroidManifest.xml` and checked/guarded correctly everywhere
 * they are consumed, yet neither could EVER be granted on a real device, because no flow anywhere
 * in the app opened [android.provider.Settings.ACTION_USAGE_ACCESS_SETTINGS] or called
 * `requestPermissions` for `POST_NOTIFICATIONS`. A pure-logic test cannot catch that class of
 * defect -- only asserting the wiring exists can. Same static-scan shape and directory-resolution
 * discipline as [ChildHomeDisclosureStaticTest].
 */
class PermissionOnboardingWiringStaticTest {

    private fun read(relative: String): String {
        val candidates = listOf(File("src/main/$relative"), File("app/src/main/$relative"))
        return candidates.firstOrNull { it.exists() }?.readText()
            ?: error("$relative was not found from working directory ${File(".").absolutePath}")
    }

    @Test
    fun `MainActivity really hands off to the usage access settings screen`() {
        val source = read("java/org/pca/app/MainActivity.kt")
        assertTrue(
            "no ACTION_USAGE_ACCESS_SETTINGS hand-off -- PACKAGE_USAGE_STATS can never be granted without it",
            source.contains("Settings.ACTION_USAGE_ACCESS_SETTINGS"),
        )
        assertTrue(source.contains("UsageAccessOnboardingPolicy"))
    }

    @Test
    fun `MainActivity really requests POST_NOTIFICATIONS at runtime`() {
        val source = read("java/org/pca/app/MainActivity.kt")
        assertTrue(
            "no POST_NOTIFICATIONS runtime request -- every notification-delivered feature stays inert on API 33+",
            source.contains("Manifest.permission.POST_NOTIFICATIONS"),
        )
        assertTrue(source.contains("requestPermissions("))
        assertTrue(source.contains("NotificationPermissionPromptPolicy"))
    }

    @Test
    fun `the child home surface exposes both onboarding cards and their honest unavailable copy`() {
        val source = read("java/org/pca/app/runtime/ui/ChildHomeScreen.kt")
        val english = read("res/values/runtime_strings.xml")
        val arabic = read("res/values-ar/runtime_strings.xml")

        assertTrue(source.contains("UsageAccessOnboardingCard"))
        assertTrue(source.contains("NotificationPermissionCard"))
        assertTrue(source.contains("onRequestUsageAccess"))
        assertTrue(source.contains("onRequestNotificationPermission"))

        for (key in listOf(
            "child_home_usage_access_explanation",
            "child_home_usage_access_capability_unavailable",
            "child_home_usage_access_device_unsupported",
            "child_home_notifications_explanation",
            "child_home_notifications_capability_unavailable",
        )) {
            assertTrue("English runtime_strings.xml is missing $key", english.contains(key))
            assertTrue("Arabic runtime_strings.xml is missing $key", arabic.contains(key))
        }
    }

    /**
     * The manifest declaration and the hand-off must stay together: a future edit that drops either
     * one silently restores the original defect (a permission that can never be granted, or a
     * settings screen the app has no reason to open).
     */
    @Test
    fun `the manifest still declares both permissions the onboarding flow exists to obtain`() {
        val manifest = read("AndroidManifest.xml")
        assertTrue(manifest.contains("android.permission.PACKAGE_USAGE_STATS"))
        assertTrue(manifest.contains("android.permission.POST_NOTIFICATIONS"))
    }
}
