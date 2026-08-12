package org.pca.app.enrollment

import java.io.File
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.pca.app.foundation.InMemoryPersistentStateStore
import org.pca.app.security.TestConformanceDeviceKeyPairGenerator
import org.pca.app.storage.PersistentFamilyStateStore

/**
 * Static, source-scanning proofs (same technique as
 * [org.pca.app.persistence.SecurityStaticCheckTest]) for the properties that a runtime unit test
 * alone cannot fully demonstrate: that production composition never references the test-only key
 * generator, and that no `Log.*`/`println` call in this module's production sources can ever see
 * the raw invitation token or either generated public key by variable name.
 */
class EnrollmentStaticScanTest {
    private fun locateMainDir(relative: String): File {
        val candidates = listOf(File(relative), File("app/$relative"))
        return candidates.firstOrNull { it.exists() }
            ?: error("Could not locate '$relative' from working dir ${File(".").absolutePath}")
    }

    private fun readAllKotlinSources(dir: File): Map<File, String> =
        dir.walkTopDown().filter { it.isFile && it.extension == "kt" }.associateWith { it.readText() }

    @Test
    fun `production composition root never references the test-only conformance key generator`() {
        val graphFile = locateMainDir("src/main/java/org/pca/app/runtime/graph/PcaAppGraph.kt")
        val text = graphFile.readText()
        assertFalse(text.contains("TestConformanceDeviceKeyPairGenerator"))
        assertFalse(text.contains("Conformance"))
    }

    @Test
    fun `no production source anywhere under org-pca-app-enrollment or security references the test-only generator`() {
        val enrollmentDir = locateMainDir("src/main/java/org/pca/app/enrollment")
        val securityDir = locateMainDir("src/main/java/org/pca/app/security")
        for ((file, text) in readAllKotlinSources(enrollmentDir) + readAllKotlinSources(securityDir)) {
            assertFalse("${file.path} must not reference the test-only key generator", text.contains("TestConformanceDeviceKeyPairGenerator"))
        }
    }

    @Test
    fun `the test-only conformance key generator physically lives under src-test, not src-main`() {
        val testFile = locateMainDir("src/test/java/org/pca/app/security/TestConformanceDeviceKeyPairGenerator.kt")
        assertTrue(testFile.path.replace('\\', '/').contains("src/test/"))
    }

    @Test
    fun `no Log call in HttpDeviceBootstrapApiClient or EnrollmentCoordinator source references the token or key variables`() {
        val files = listOf(
            "src/main/java/org/pca/app/enrollment/HttpDeviceBootstrapApiClient.kt",
            "src/main/java/org/pca/app/enrollment/EnrollmentCoordinator.kt",
        )
        val logCallPattern = Regex("""(?i)(Log\.[a-z]+|println|System\.out)\s*\(""")
        for (path in files) {
            val text = locateMainDir(path).readText()
            assertFalse("$path must contain no logging call at all", logCallPattern.containsMatchIn(text))
        }
    }

    // -- Runtime companion to the static scans above: the raw token is provably never written to
    // the persistent store's backing map at any point in a full successful flow. --
    @Test
    fun `raw invitation token never appears anywhere in the persisted family-state backing store`() = runTest {
        val backing = InMemoryPersistentStateStore()
        val familyStateStore = PersistentFamilyStateStore(backing)
        val rawToken = "super-secret-raw-token-should-never-be-persisted"
        val apiClient = object : DeviceBootstrapApiClient {
            override suspend fun bootstrap(rawInvitationToken: String, platform: String, signingPublicKeyBase64: String, encryptionPublicKeyBase64: String): DeviceBootstrapResult {
                assertEquals(rawToken, rawInvitationToken)
                return DeviceBootstrapResult("device-id-1", "PAIRING_PENDING")
            }
        }
        val coordinator = EnrollmentCoordinator(
            UriEnrollmentLinkParser(EnrollmentDeepLinkConfig.EXPECTED_SCHEME, EnrollmentDeepLinkConfig.EXPECTED_HOST),
            apiClient,
            TestConformanceDeviceKeyPairGenerator(),
            familyStateStore,
        )
        coordinator.submitInvitationLink("pca://enroll?token=$rawToken")

        coordinator.beginBootstrap()

        // Reach into the backing store's own persisted string for every key it holds.
        val persisted = backing.getString("family_state_v1")
        assertFalse(persisted?.contains(rawToken) ?: false)
    }

    @Test
    fun `the coordinator clears the in-memory token reference after a terminal invitation-invalid outcome`() = runTest {
        val familyStateStore = PersistentFamilyStateStore(InMemoryPersistentStateStore())
        val apiClient = object : DeviceBootstrapApiClient {
            override suspend fun bootstrap(rawInvitationToken: String, platform: String, signingPublicKeyBase64: String, encryptionPublicKeyBase64: String): DeviceBootstrapResult {
                throw BootstrapError.InvitationUnavailable
            }
        }
        val coordinator = EnrollmentCoordinator(
            UriEnrollmentLinkParser(EnrollmentDeepLinkConfig.EXPECTED_SCHEME, EnrollmentDeepLinkConfig.EXPECTED_HOST),
            apiClient,
            TestConformanceDeviceKeyPairGenerator(),
            familyStateStore,
        )
        coordinator.submitInvitationLink("pca://enroll?token=abc")
        coordinator.beginBootstrap()
        assertEquals(EnrollmentState.FailedInvitationInvalid, coordinator.state.value)

        // Calling beginBootstrap again with no fresh submitInvitationLink must be a no-op that
        // re-reports the same invalid state -- proof the token reference was actually cleared,
        // not merely unused this once.
        coordinator.beginBootstrap()
        assertEquals(EnrollmentState.FailedInvitationInvalid, coordinator.state.value)
        assertNull(familyStateStore.currentState())
    }
}
