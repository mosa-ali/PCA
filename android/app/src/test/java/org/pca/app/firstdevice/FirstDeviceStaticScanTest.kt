package org.pca.app.firstdevice

import java.io.File
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Wave 6C static (source-scanning) proofs -- the properties a runtime unit
 * test cannot fully demonstrate:
 *  - the ceremony package can never touch device lifecycle state
 *    (no [org.pca.app.enrollment.PairingState], no FamilyStateStore);
 *  - no logging call exists in any ceremony source (no token/key/evidence
 *    can leak through a log line by construction);
 *  - production composition pins: PcaAppGraph constructs the REAL
 *    AndroidKeystore provider and the ceremony coordinator, and never the
 *    fail-closed pre-approval generator nor any test double.
 */
class FirstDeviceStaticScanTest {
    private fun locateMainDir(relative: String): File {
        val candidates = listOf(File(relative), File("app/$relative"))
        return candidates.firstOrNull { it.exists() }
            ?: error("Could not locate '$relative' from working dir ${File(".").absolutePath}")
    }

    private fun readAllKotlinSources(dir: File): Map<File, String> =
        dir.walkTopDown().filter { it.isFile && it.extension == "kt" }.associateWith { it.readText() }

    @Test
    fun `the ceremony package never references device lifecycle state or logging`() {
        val dir = locateMainDir("src/main/java/org/pca/app/firstdevice")
        val logCallPattern = Regex("""(?i)(Log\.[a-z]+|println|System\.out)\s*\(""")
        for ((file, text) in readAllKotlinSources(dir)) {
            assertFalse("${file.path} must not reference PairingState", text.contains("PairingState"))
            assertFalse("${file.path} must not reference FamilyStateStore", text.contains("FamilyStateStore"))
            assertFalse("${file.path} must contain no logging call at all", logCallPattern.containsMatchIn(text))
            assertFalse("${file.path} must never export private key bytes", text.contains("privateKey.encoded") || text.contains("privateKey.getEncoded"))
        }
    }

    @Test
    fun `the keystore provider never exports or logs private key material`() {
        val provider = locateMainDir("src/main/java/org/pca/app/security/AndroidKeystoreDskProvider.kt").readText()
        val logCallPattern = Regex("""(?i)(Log\.[a-z]+|println|System\.out)\s*\(""")
        assertFalse(logCallPattern.containsMatchIn(provider))
        assertFalse(provider.contains("privateKey.encoded"))
        assertFalse(provider.contains("privateKey.getEncoded"))
        // The only private-key surface is initSign over the keystore handle.
        assertTrue(provider.contains("initSign(privateKey)"))
    }

    @Test
    fun `production composition constructs the real provider and coordinator, never the pre-approval generator`() {
        val graph = locateMainDir("src/main/java/org/pca/app/runtime/graph/PcaAppGraph.kt").readText()
        assertTrue(graph.contains("AndroidKeystoreDskProvider()"))
        assertFalse(graph.contains("NotApprovedDeviceKeyPairGenerator("))
        assertFalse(graph.contains("TestConformanceDeviceKeyPairGenerator"))
        assertTrue(graph.contains("FirstDeviceTrustRootCoordinator("))
        assertTrue(graph.contains("firstDeviceRootStore = firstDeviceRootStore"))
        assertTrue(graph.contains("PersistentFirstDeviceRootStore(runtimeStateStore)"))
    }

    @Test
    fun `no production source under firstdevice or security references the test-only generator`() {
        val dirs = listOf(
            locateMainDir("src/main/java/org/pca/app/firstdevice"),
            locateMainDir("src/main/java/org/pca/app/security"),
        )
        for (dir in dirs) {
            for ((file, text) in readAllKotlinSources(dir)) {
                assertFalse("${file.path} must not reference the test-only key generator", text.contains("TestConformanceDeviceKeyPairGenerator"))
            }
        }
    }
}
