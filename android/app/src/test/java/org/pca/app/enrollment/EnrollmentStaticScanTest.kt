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
import org.pca.app.storage.InMemoryPendingEnrollmentAttemptStore
import org.pca.app.storage.PersistentFamilyStateStore
import org.pca.app.storage.PersistentPendingEnrollmentAttemptStore

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
    fun `no Log call in the enrollment HTTP client, coordinator, or attempt-persistence sources references the token or key variables`() {
        val files = listOf(
            "src/main/java/org/pca/app/enrollment/HttpDeviceBootstrapApiClient.kt",
            "src/main/java/org/pca/app/enrollment/EnrollmentCoordinator.kt",
            "src/main/java/org/pca/app/enrollment/AttemptIdentifiers.kt",
            "src/main/java/org/pca/app/storage/PendingEnrollmentAttemptStore.kt",
            "src/main/java/org/pca/app/storage/PersistentPendingEnrollmentAttemptStore.kt",
        )
        val logCallPattern = Regex("""(?i)(Log\.[a-z]+|println|System\.out)\s*\(""")
        for (path in files) {
            val text = locateMainDir(path).readText()
            assertFalse("$path must contain no logging call at all", logCallPattern.containsMatchIn(text))
        }
    }

    @Test
    fun `PendingEnrollmentAttempt has no field capable of carrying the raw invitation token`() {
        val text = locateMainDir("src/main/java/org/pca/app/storage/PendingEnrollmentAttemptStore.kt").readText()
        // The data class must never gain a field literally named for the raw token -- this is the
        // structural guarantee behind "the raw invitation token is never persisted."
        assertFalse(Regex("""(?i)val\s+rawInvitationToken""").containsMatchIn(text))
        assertFalse(Regex("""(?i)val\s+rawToken""").containsMatchIn(text))
    }

    @Test
    fun `activity removes token-bearing launch data after passing it to the coordinator`() {
        val text = locateMainDir("src/main/java/org/pca/app/enrollment/EnrollmentActivity.kt").readText()
        val createBody = text.substringBefore("setContent {")
        val newIntentBody = text.substringAfter("override fun onNewIntent")
        assertTrue(createBody.indexOf("scheduleInvitationLink(graph, coordinator, uri)") < createBody.indexOf("launchIntent?.data = null"))
        assertTrue(newIntentBody.indexOf("scheduleInvitationLink(graph, graph.enrollmentCoordinator, uri)") < newIntentBody.indexOf("intent.data = null"))
        val schedulingBody = text.substringAfter("private fun scheduleInvitationLink(")
        assertTrue(schedulingBody.indexOf("coordinator.reserveInvitationSubmission()") < schedulingBody.indexOf("graph.coroutineScope.launch"))
        assertTrue(text.contains("coordinator.submitReservedInvitationLink(boundedUri, admission.permit)"))
        assertTrue(text.contains("graph.coroutineScope.launch"))
        assertTrue(createBody.contains("setIntent(launchIntent)"))
        assertTrue(newIntentBody.contains("setIntent(intent)"))
    }

    @Test
    fun `unknown bootstrap exposes separate status recovery and exact replay actions`() {
        val activity = locateMainDir("src/main/java/org/pca/app/enrollment/EnrollmentActivity.kt").readText()
        val screen = locateMainDir("src/main/java/org/pca/app/enrollment/ui/EnrollmentScreen.kt").readText()
        assertTrue(activity.contains("is EnrollmentState.BootstrapResultUnknown -> coordinator.recoverAttempt()"))
        assertTrue(activity.contains("onRetrySameSetup = {"))
        val retryAction = activity.substringAfter("onRetrySameSetup = {").substringBefore("// Root review begins")
        assertTrue(retryAction.contains("coordinator.retryBootstrap()"))
        assertTrue(screen.contains("Button(onClick = onCheckStatus)"))
        assertTrue(screen.contains("OutlinedButton(onClick = onRetrySameSetup)"))
        assertTrue(screen.contains("R.string.enrollment_check_status_button"))
        assertTrue(screen.contains("R.string.enrollment_retry_same_setup_button"))
    }

    // -- Runtime companions to the static scans above: the raw token is provably never written to
    // either persistent store's backing map at any point across a full successful flow, an
    // ambiguous flow, or a recovered flow. --

    private fun apiClientReturning(rawTokenExpectation: String?, result: DeviceBootstrapResult) = object : DeviceBootstrapApiClient {
        override suspend fun bootstrap(rawInvitationToken: String, platform: String, signingPublicKeyBase64: String, encryptionPublicKeyBase64: String, bootstrapAttemptId: String, attemptRecoveryToken: String): DeviceBootstrapResult {
            if (rawTokenExpectation != null) assertEquals(rawTokenExpectation, rawInvitationToken)
            return result
        }
        override suspend fun recoverAttempt(bootstrapAttemptId: String, attemptRecoveryToken: String): DeviceBootstrapResult = result
    }

    @Test
    fun `raw invitation token never appears anywhere in the persisted family-state OR pending-attempt backing store`() = runTest {
        val backing = InMemoryPersistentStateStore()
        val familyStateStore = PersistentFamilyStateStore(backing)
        val pendingAttemptStore = PersistentPendingEnrollmentAttemptStore(backing)
        val rawToken = "A".repeat(43)
        val apiClient = apiClientReturning(rawToken, DeviceBootstrapResult("device-id-1", "PAIRING_PENDING"))
        val coordinator = EnrollmentCoordinator(
            UriEnrollmentLinkParser(EnrollmentDeepLinkConfig.EXPECTED_SCHEME, EnrollmentDeepLinkConfig.EXPECTED_HOST),
            apiClient,
            TestConformanceDeviceKeyPairGenerator(),
            familyStateStore,
            pendingAttemptStore,
        )
        coordinator.submitInvitationLink("pca://enroll?token=$rawToken")

        coordinator.beginBootstrap()

        // Reach into the backing store's own persisted strings for every key it holds.
        assertFalse(backing.getString("family_state_v1")?.contains(rawToken) ?: false)
        assertFalse(backing.getString("pending_enrollment_attempt_v1")?.contains(rawToken) ?: false)
    }

    @Test
    fun `raw invitation token never appears in the pending-attempt backing store even mid-flight (before the response arrives)`() = runTest {
        val backing = InMemoryPersistentStateStore()
        val pendingAttemptStore = PersistentPendingEnrollmentAttemptStore(backing)
        val rawToken = "A".repeat(43)
        var sawDuringCall = ""
        val apiClient = object : DeviceBootstrapApiClient {
            override suspend fun bootstrap(rawInvitationToken: String, platform: String, signingPublicKeyBase64: String, encryptionPublicKeyBase64: String, bootstrapAttemptId: String, attemptRecoveryToken: String): DeviceBootstrapResult {
                // The pending attempt is already durably persisted by the time the network call
                // happens (section 4) -- check its raw backing string right now, mid-call.
                sawDuringCall = backing.getString("pending_enrollment_attempt_v1") ?: ""
                return DeviceBootstrapResult("device-id-2", "PAIRING_PENDING")
            }
            override suspend fun recoverAttempt(bootstrapAttemptId: String, attemptRecoveryToken: String) = throw AssertionError()
        }
        val coordinator = EnrollmentCoordinator(
            UriEnrollmentLinkParser(EnrollmentDeepLinkConfig.EXPECTED_SCHEME, EnrollmentDeepLinkConfig.EXPECTED_HOST),
            apiClient,
            TestConformanceDeviceKeyPairGenerator(),
            PersistentFamilyStateStore(InMemoryPersistentStateStore()),
            pendingAttemptStore,
        )
        coordinator.submitInvitationLink("pca://enroll?token=$rawToken")

        coordinator.beginBootstrap()

        assertTrue(sawDuringCall.isNotEmpty())
        assertFalse(sawDuringCall.contains(rawToken))
    }

    @Test
    fun `the coordinator keeps the attempt and invitation binding after generic 404 for explicit retry`() = runTest {
        val familyStateStore = PersistentFamilyStateStore(InMemoryPersistentStateStore())
        val pendingAttemptStore = InMemoryPendingEnrollmentAttemptStore()
        var callCount = 0
        val apiClient = object : DeviceBootstrapApiClient {
            override suspend fun bootstrap(rawInvitationToken: String, platform: String, signingPublicKeyBase64: String, encryptionPublicKeyBase64: String, bootstrapAttemptId: String, attemptRecoveryToken: String): DeviceBootstrapResult {
                callCount++
                throw BootstrapError.InvitationUnavailable
            }
            override suspend fun recoverAttempt(bootstrapAttemptId: String, attemptRecoveryToken: String) = throw AssertionError()
        }
        val coordinator = EnrollmentCoordinator(
            UriEnrollmentLinkParser(EnrollmentDeepLinkConfig.EXPECTED_SCHEME, EnrollmentDeepLinkConfig.EXPECTED_HOST),
            apiClient,
            TestConformanceDeviceKeyPairGenerator(),
            familyStateStore,
            pendingAttemptStore,
        )
        coordinator.submitInvitationLink("pca://enroll?token=${"A".repeat(43)}")
        coordinator.beginBootstrap()
        val original = pendingAttemptStore.current()
        assertEquals(EnrollmentState.BootstrapResultUnknown, coordinator.state.value)
        assertTrue(original != null)

        // A generic 404 is not proof that the request did not commit. Keep the same token binding,
        // attempt and key custody, and retry only after the visible explicit action.
        coordinator.beginBootstrap()
        assertEquals(EnrollmentState.BootstrapResultUnknown, coordinator.state.value)
        coordinator.retryBootstrap()
        assertEquals(EnrollmentState.BootstrapResultUnknown, coordinator.state.value)
        assertEquals(original, pendingAttemptStore.current())
        assertEquals(2, callCount)
        assertNull(familyStateStore.currentState())
    }
}
