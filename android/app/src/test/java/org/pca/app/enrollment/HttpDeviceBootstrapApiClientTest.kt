package org.pca.app.enrollment

import java.net.ServerSocket
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/**
 * Real HTTP round-trips (real sockets, real bytes-on-the-wire) against [FakeHttpServer] --
 * verifies [HttpDeviceBootstrapApiClient] against bootstrapRoutes.ts's verified contract: request
 * body shape, and the 201/404/400/network-timeout/malformed-body error mapping for `bootstrap`,
 * and the 200/404/400/network-timeout/malformed-body error mapping for `recoverAttempt`
 * (PCA-ENROLLMENT-RUNTIME-2), without mocking the transport layer itself.
 */
class HttpDeviceBootstrapApiClientTest {
    private var server: FakeHttpServer? = null

    @After
    fun tearDown() {
        server?.stop()
    }

    private fun client(baseUrl: String) =
        HttpDeviceBootstrapApiClient(BootstrapEndpointConfig(baseUrl = baseUrl, allowInsecureHttp = true), connectTimeoutMillis = 2_000, readTimeoutMillis = 2_000)

    @Test
    fun `sends the exact request body contract (including bootstrapAttemptId+attemptRecoveryToken) and parses a 201 success response`() = runBlocking {
        var capturedBody: JSONObject? = null
        val fake = FakeHttpServer.start().also { server = it }
        fake.start { body ->
            capturedBody = JSONObject(body)
            201 to JSONObject().put("deviceId", "device-123").put("status", "PAIRING_PENDING").toString().toByteArray()
        }

        val result = withTimeout(5_000) {
            client(fake.baseUrl).bootstrap("raw-token-abc", "ANDROID", "signing-pub-key", "encryption-pub-key", "attempt-id-1", "recovery-token-1")
        }

        assertEquals(DeviceBootstrapResult(deviceId = "device-123", status = "PAIRING_PENDING"), result)
        assertEquals("raw-token-abc", capturedBody?.getString("rawInvitationToken"))
        assertEquals("ANDROID", capturedBody?.getString("platform"))
        assertEquals("signing-pub-key", capturedBody?.getString("signingPublicKey"))
        assertEquals("encryption-pub-key", capturedBody?.getString("encryptionPublicKey"))
        assertEquals("attempt-id-1", capturedBody?.getString("bootstrapAttemptId"))
        assertEquals("recovery-token-1", capturedBody?.getString("attemptRecoveryToken"))
    }

    @Test
    fun `maps 404 to InvitationUnavailable without distinguishing cause`() = runBlocking {
        val fake = FakeHttpServer.start().also { server = it }
        fake.start { 404 to """{"error":"invitation_unavailable"}""".toByteArray() }

        try {
            withTimeout(5_000) { client(fake.baseUrl).bootstrap("t", "ANDROID", "s", "e", "a", "r") }
            fail("expected BootstrapError.InvitationUnavailable")
        } catch (e: BootstrapError.InvitationUnavailable) {
            // expected
        }
    }

    @Test
    fun `maps 400 to InvalidRequest`() = runBlocking {
        val fake = FakeHttpServer.start().also { server = it }
        fake.start { 400 to """{"error":"invalid_request"}""".toByteArray() }

        try {
            withTimeout(5_000) { client(fake.baseUrl).bootstrap("t", "ANDROID", "s", "e", "a", "r") }
            fail("expected BootstrapError.InvalidRequest")
        } catch (e: BootstrapError.InvalidRequest) {
            // expected
        }
    }

    @Test
    fun `maps an unexpected 500 to UnexpectedServerError`() = runBlocking {
        val fake = FakeHttpServer.start().also { server = it }
        fake.start { 500 to ByteArray(0) }

        try {
            withTimeout(5_000) { client(fake.baseUrl).bootstrap("t", "ANDROID", "s", "e", "a", "r") }
            fail("expected BootstrapError.UnexpectedServerError")
        } catch (e: BootstrapError.UnexpectedServerError) {
            // expected
        }
    }

    @Test
    fun `a connection that is dropped mid-flight lands in AmbiguousOutcome, not a silent hang or false success-failure`() = runBlocking {
        val fake = FakeHttpServer.start().also { server = it }
        fake.startAndDropEveryConnection()

        try {
            withTimeout(10_000) { client(fake.baseUrl).bootstrap("t", "ANDROID", "s", "e", "a", "r") }
            fail("expected BootstrapError.AmbiguousOutcome")
        } catch (e: BootstrapError.AmbiguousOutcome) {
            // expected -- this is the honest outcome for a lost/reset response, never reported as
            // ordinary success or ordinary failure. See BOOTSTRAP_AMBIGUOUS_RETRY_PROTOCOL_GAP.
        }
    }

    @Test
    fun `an unreachable port times out into AmbiguousOutcome`() = runBlocking {
        // Reserve then immediately free a port -- nothing listens on it, so the connection attempt
        // fails fast (refused) rather than hanging; still exercises the exact same network-failure
        // path a real timeout would.
        val port = ServerSocket(0).use { it.localPort }
        val deadClient = HttpDeviceBootstrapApiClient(
            BootstrapEndpointConfig(baseUrl = "http://127.0.0.1:$port", allowInsecureHttp = true),
            connectTimeoutMillis = 1_000,
            readTimeoutMillis = 1_000,
        )

        try {
            withTimeout(10_000) { deadClient.bootstrap("t", "ANDROID", "s", "e", "a", "r") }
            fail("expected BootstrapError.AmbiguousOutcome")
        } catch (e: BootstrapError.AmbiguousOutcome) {
            // expected
        }
    }

    @Test
    fun `a 201 with an unparseable body is treated as ambiguous, not silently dropped`() = runBlocking {
        val fake = FakeHttpServer.start().also { server = it }
        fake.start { 201 to "not json at all".toByteArray() }

        try {
            withTimeout(5_000) { client(fake.baseUrl).bootstrap("t", "ANDROID", "s", "e", "a", "r") }
            fail("expected BootstrapError.AmbiguousOutcome")
        } catch (e: BootstrapError.AmbiguousOutcome) {
            // expected
        }
    }

    @Test
    fun `a 201 missing deviceId is treated as ambiguous, never returned with a blank id`() = runBlocking {
        val fake = FakeHttpServer.start().also { server = it }
        fake.start { 201 to JSONObject().put("status", "PAIRING_PENDING").toString().toByteArray() }

        try {
            withTimeout(5_000) { client(fake.baseUrl).bootstrap("t", "ANDROID", "s", "e", "a", "r") }
            fail("expected BootstrapError.AmbiguousOutcome")
        } catch (e: BootstrapError.AmbiguousOutcome) {
            // expected
        }
    }

    @Test
    fun `an oversized response body is treated as ambiguous rather than trusted-truncated`() = runBlocking {
        val fake = FakeHttpServer.start().also { server = it }
        fake.start {
            val huge = "{\"deviceId\":\"" + "x".repeat(20_000) + "\",\"status\":\"PAIRING_PENDING\"}"
            201 to huge.toByteArray()
        }

        try {
            withTimeout(5_000) { client(fake.baseUrl).bootstrap("t", "ANDROID", "s", "e", "a", "r") }
            fail("expected BootstrapError.AmbiguousOutcome")
        } catch (e: BootstrapError.AmbiguousOutcome) {
            // expected
        }
    }

    @Test
    fun `production config refuses plain http against a non-local host`() {
        try {
            BootstrapEndpointConfig(baseUrl = "http://api.pca.app")
            fail("expected IllegalArgumentException")
        } catch (e: IllegalArgumentException) {
            assertTrue(e.message?.contains("Refusing") == true)
        }
    }

    @Test
    fun `https is always accepted regardless of host`() {
        BootstrapEndpointConfig(baseUrl = "https://api.pca.app")
    }

    @Test
    fun `plain http is accepted only for local dev hosts, and only opted in`() {
        try {
            BootstrapEndpointConfig(baseUrl = "http://127.0.0.1:8080", allowInsecureHttp = false)
            fail("expected IllegalArgumentException")
        } catch (e: IllegalArgumentException) {
            // expected: local host alone is not enough without the explicit opt-in
        }
        BootstrapEndpointConfig(baseUrl = "http://127.0.0.1:8080", allowInsecureHttp = true)
    }

    // --- PCA-ENROLLMENT-RUNTIME-2: recoverAttempt() ---

    @Test
    fun `recoverAttempt sends only bootstrapAttemptId+attemptRecoveryToken -- never a raw invitation token field`() = runBlocking {
        var capturedBody: JSONObject? = null
        val fake = FakeHttpServer.start().also { server = it }
        fake.start { body ->
            capturedBody = JSONObject(body)
            200 to JSONObject().put("deviceId", "recovered-device").put("status", "PAIRING_PENDING").toString().toByteArray()
        }

        val result = withTimeout(5_000) { client(fake.baseUrl).recoverAttempt("attempt-id-1", "recovery-token-1") }

        assertEquals(DeviceBootstrapResult(deviceId = "recovered-device", status = "PAIRING_PENDING"), result)
        assertEquals("attempt-id-1", capturedBody?.getString("bootstrapAttemptId"))
        assertEquals("recovery-token-1", capturedBody?.getString("attemptRecoveryToken"))
        assertFalse(capturedBody?.has("rawInvitationToken") ?: true)
    }

    @Test
    fun `recoverAttempt maps 404 to RecoveryError NotFound -- unknown attempt id and wrong recovery secret are indistinguishable`() = runBlocking {
        val fake = FakeHttpServer.start().also { server = it }
        fake.start { 404 to """{"error":"invitation_unavailable"}""".toByteArray() }

        try {
            withTimeout(5_000) { client(fake.baseUrl).recoverAttempt("a", "r") }
            fail("expected RecoveryError.NotFound")
        } catch (e: RecoveryError.NotFound) {
            // expected
        }
    }

    @Test
    fun `recoverAttempt maps 400 to RecoveryError InvalidRequest`() = runBlocking {
        val fake = FakeHttpServer.start().also { server = it }
        fake.start { 400 to """{"error":"invalid_request"}""".toByteArray() }

        try {
            withTimeout(5_000) { client(fake.baseUrl).recoverAttempt("a", "r") }
            fail("expected RecoveryError.InvalidRequest")
        } catch (e: RecoveryError.InvalidRequest) {
            // expected
        }
    }

    @Test
    fun `recoverAttempt maps an unexpected 500 to RecoveryError UnexpectedServerError`() = runBlocking {
        val fake = FakeHttpServer.start().also { server = it }
        fake.start { 500 to ByteArray(0) }

        try {
            withTimeout(5_000) { client(fake.baseUrl).recoverAttempt("a", "r") }
            fail("expected RecoveryError.UnexpectedServerError")
        } catch (e: RecoveryError.UnexpectedServerError) {
            // expected
        }
    }

    @Test
    fun `recoverAttempt -- a dropped connection lands in RecoveryError AmbiguousOutcome, not a false definitive answer`() = runBlocking {
        val fake = FakeHttpServer.start().also { server = it }
        fake.startAndDropEveryConnection()

        try {
            withTimeout(10_000) { client(fake.baseUrl).recoverAttempt("a", "r") }
            fail("expected RecoveryError.AmbiguousOutcome")
        } catch (e: RecoveryError.AmbiguousOutcome) {
            // expected -- this must never be treated as NotFound (that would incorrectly abandon a
            // still-possibly-valid attempt); see EnrollmentCoordinator.recoverAttempt's own doc.
        }
    }

    @Test
    fun `recoverAttempt -- a 200 with an unparseable body is treated as ambiguous, not silently dropped`() = runBlocking {
        val fake = FakeHttpServer.start().also { server = it }
        fake.start { 200 to "not json at all".toByteArray() }

        try {
            withTimeout(5_000) { client(fake.baseUrl).recoverAttempt("a", "r") }
            fail("expected RecoveryError.AmbiguousOutcome")
        } catch (e: RecoveryError.AmbiguousOutcome) {
            // expected
        }
    }
}
