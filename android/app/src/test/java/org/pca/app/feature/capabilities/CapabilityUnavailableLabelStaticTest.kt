package org.pca.app.feature.capabilities

import java.io.File
import org.junit.Assert.assertTrue
import org.junit.Test

class CapabilityUnavailableLabelStaticTest {
    private fun read(relative: String): String {
        val candidates = listOf(File("src/main/java/$relative"), File("app/src/main/java/$relative"))
        return candidates.firstOrNull { it.exists() }?.readText() ?: error("$relative was not found")
    }

    @Test
    fun `child status screen labels unsupported protection and location capabilities`() {
        val source = read("org/pca/app/runtime/ui/ChildHomeScreen.kt")
        assertTrue(source.contains("ProtectionMode.NOT_SUPPORTED"))
        assertTrue(source.contains("LocationCapabilityLevel.UNUSABLE"))
        assertTrue(source.contains("child_home_protection_not_supported"))
        assertTrue(source.contains("child_home_location_unusable"))
    }

    @Test
    fun `youtube mode screen labels unsupported usage and unavailable mode`() {
        val source = read("org/pca/app/feature/youtube/ui/YouTubeModeScreen.kt")
        assertTrue(source.contains("UsageCapabilityStatus.UNSUPPORTED"))
        assertTrue(source.contains("youtube_mode_a_status_unsupported"))
        assertTrue(source.contains("youtube_mode_b_unavailable"))
    }
}
