package org.pca.app.enrollment

import java.net.ServerSocket
import java.util.concurrent.atomic.AtomicReference
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

    private fun validSuccessBody(deviceId: String = "device-123") = JSONObject()
        .put("deviceId", deviceId)
        .put("status", "PAIRING_PENDING")
        .put("signingKeyId", "dsk-key-123")
        .put("encryptionKeyId", "dek-key-123")
        .put("ageUxTier", "TEEN")
        .put("initialPolicyProfile", "STRICT")
        .put("childProfileId", JSONObject.NULL)

    private fun malformedStringFieldBody(field: String, representation: String): JSONObject = validSuccessBody().apply {
        when (representation) {
            "missing" -> remove(field)
            "null" -> put(field, JSONObject.NULL)
            "blank" -> put(field, "")
            "unknown" -> put(field, "UNRECOGNIZED")
            "number" -> put(field, 123)
            "object" -> put(field, JSONObject().put("value", "TEEN"))
            else -> error("unknown malformed representation: $representation")
        }
    }

    private fun malformedProfileBody(field: String, representation: String): JSONObject =
        malformedStringFieldBody(field, representation)

    @Test
    fun `prepareAttempt sends the exact reservation tuple to its route and accepts READY`() = runBlocking {
        var captured: FakeHttpRequest? = null
        val fake = FakeHttpServer.start().also { server = it }
        fake.startRequest { request ->
            captured = request
            200 to """{"status":"READY"}""".toByteArray()
        }

        withTimeout(5_000) {
            client(fake.baseUrl).prepareAttempt(
                "raw-token-abc", "ANDROID", "signing-pub-key", "encryption-pub-key", "attempt-id-1", "recovery-token-1",
            )
        }

        val request = requireNotNull(captured) { "prepare request was not captured" }
        assertEquals("POST", request.method)
        assertEquals("/v1/enrollment/bootstrap/prepare", request.path)
        val body = JSONObject(request.body)
        assertEquals("raw-token-abc", body.getString("rawInvitationToken"))
        assertEquals("ANDROID", body.getString("platform"))
        assertEquals("signing-pub-key", body.getString("signingPublicKey"))
        assertEquals("encryption-pub-key", body.getString("encryptionPublicKey"))
        assertEquals("attempt-id-1", body.getString("bootstrapAttemptId"))
        assertEquals("recovery-token-1", body.getString("attemptRecoveryToken"))
    }

    @Test
    fun `prepareAttempt maps unavailable response without inventing a successful reservation`() = runBlocking {
        val fake = FakeHttpServer.start().also { server = it }
        fake.start { 404 to " \r\n{\t\"error\"\n:\r\"invitation_unavailable\"\t}\n ".toByteArray() }
        try {
            withTimeout(5_000) {
                client(fake.baseUrl).prepareAttempt("token", "ANDROID", "dsk", "dek", "attempt", "recovery")
            }
            fail("expected BootstrapError.InvitationUnavailable")
        } catch (_: BootstrapError.InvitationUnavailable) {
            // The reservation is not treated as ready after a generic 404.
        }
    }

    @Test
    fun `all 404 routes require the exact bounded invitation unavailable envelope`() = runBlocking {
        val responseBody = AtomicReference(ByteArray(0))
        val fake = FakeHttpServer.start().also { server = it }
        fake.startRequest { 404 to responseBody.get() }
        val api = client(fake.baseUrl)
        val invalidBodies = listOf(
            ByteArray(0),
            "Not Found".toByteArray(),
            """{"error":"not_found"}""".toByteArray(),
            """{"error":"invitation_unavailable","extra":true}""".toByteArray(),
            """{"error":"invitation_unavailable","error":"other"}""".toByteArray(),
            """{"error":"invitation_unavailable""".toByteArray(),
            """{"error":"invitation_unavailable"} trailing""".toByteArray(),
            "\u00a0{\"error\":\"invitation_unavailable\"}".toByteArray(),
            ByteArray(8 * 1024) { 'x'.code.toByte() },
        )

        for (body in invalidBodies) {
            responseBody.set(body)
            try {
                withTimeout(5_000) {
                    api.prepareAttempt("token", "ANDROID", "dsk", "dek", "attempt", "recovery")
                }
                fail("prepare 404 body must be ambiguous")
            } catch (_: BootstrapError.AmbiguousOutcome) {
                // Unrecognized/missing/oversized API errors are not proof that a reservation is absent.
            }

            responseBody.set(body)
            try {
                withTimeout(5_000) {
                    api.bootstrap("token", "ANDROID", "dsk", "dek", "attempt", "recovery")
                }
                fail("bootstrap 404 body must be ambiguous")
            } catch (_: BootstrapError.AmbiguousOutcome) {
                // Preserve the exact attempt when the response is not the backend's canonical error.
            }

            responseBody.set(body)
            try {
                withTimeout(5_000) { api.recoverAttempt("attempt", "recovery") }
                fail("recovery 404 body must be ambiguous")
            } catch (_: RecoveryError.AmbiguousOutcome) {
                // Do not release attempt or key custody based on a route/proxy 404.
            }
        }
    }

    @Test
    fun `recoverAttempt recognizes the explicit abandoned terminal response on the recovery route`() = runBlocking {
        var captured: FakeHttpRequest? = null
        val fake = FakeHttpServer.start().also { server = it }
        fake.startRequest { request ->
            captured = request
            200 to """{"status":"ATTEMPT_ABANDONED"}""".toByteArray()
        }
        try {
            withTimeout(5_000) { client(fake.baseUrl).recoverAttempt("attempt-id-1", "recovery-token-1") }
            fail("expected RecoveryError.AttemptAbandoned")
        } catch (_: RecoveryError.AttemptAbandoned) {
            // The explicit terminal status is distinct from a generic recovery 404.
        }
        val request = requireNotNull(captured) { "recovery request was not captured" }
        assertEquals("POST", request.method)
        assertEquals("/v1/enrollment/bootstrap/recover", request.path)
        val body = JSONObject(request.body)
        assertEquals("attempt-id-1", body.getString("bootstrapAttemptId"))
        assertEquals("recovery-token-1", body.getString("attemptRecoveryToken"))
        assertFalse(body.has("rawInvitationToken"))
    }

    @Test
    fun `sends the exact request body contract (including bootstrapAttemptId+attemptRecoveryToken) and parses a 201 success response`() = runBlocking {
        var capturedBody: JSONObject? = null
        val fake = FakeHttpServer.start().also { server = it }
        fake.start { body ->
            capturedBody = JSONObject(body)
            201 to validSuccessBody().toString().toByteArray()
        }

        val result = withTimeout(5_000) {
            client(fake.baseUrl).bootstrap("raw-token-abc", "ANDROID", "signing-pub-key", "encryption-pub-key", "attempt-id-1", "recovery-token-1")
        }

        assertEquals(
            DeviceBootstrapResult(
                deviceId = "device-123",
                status = "PAIRING_PENDING",
                signingKeyId = "dsk-key-123",
                encryptionKeyId = "dek-key-123",
                ageUxTier = AgeUxTier.TEEN,
                initialPolicyProfile = InitialPolicyProfile.STRICT,
            ),
            result,
        )
        assertEquals("raw-token-abc", capturedBody?.getString("rawInvitationToken"))
        assertEquals("ANDROID", capturedBody?.getString("platform"))
        assertEquals("signing-pub-key", capturedBody?.getString("signingPublicKey"))
        assertEquals("encryption-pub-key", capturedBody?.getString("encryptionPublicKey"))
        assertEquals("attempt-id-1", capturedBody?.getString("bootstrapAttemptId"))
        assertEquals("recovery-token-1", capturedBody?.getString("attemptRecoveryToken"))
    }

    @Test
    fun `bootstrap and recovery preserve an explicit nonblank child profile id`() = runBlocking {
        val statusCode = AtomicReference(201)
        val responseBody = AtomicReference(validSuccessBody().put("childProfileId", "child-profile-123").toString())
        val fake = FakeHttpServer.start().also { server = it }
        fake.start { statusCode.get() to responseBody.get().toByteArray() }
        val api = client(fake.baseUrl)

        val bootstrapResult = withTimeout(5_000) {
            api.bootstrap("t", "ANDROID", "s", "e", "attempt", "recovery")
        }
        assertEquals("child-profile-123", bootstrapResult.childProfileId)

        statusCode.set(200)
        val recoveredResult = withTimeout(5_000) {
            api.recoverAttempt("attempt", "recovery")
        }
        assertEquals("child-profile-123", recoveredResult.childProfileId)
    }

    @Test
    fun `a 201 without the server-minted key ids is ambiguous -- the attempt is preserved for recovery`() = runBlocking {
        val fake = FakeHttpServer.start().also { server = it }
        fake.start {
            val body = validSuccessBody().apply {
                remove("signingKeyId")
                remove("encryptionKeyId")
            }
            201 to body.toString().toByteArray()
        }
        try {
            withTimeout(5_000) { client(fake.baseUrl).bootstrap("t", "ANDROID", "s", "e", "a", "r") }
            fail("expected BootstrapError.AmbiguousOutcome")
        } catch (e: BootstrapError.AmbiguousOutcome) {
            // expected: a response that cannot feed the first-device ceremony
            // is treated as ambiguous, never as a partial success.
        }
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
    fun `a 201 claiming a lifecycle state beyond PAIRING_PENDING is ambiguous`() = runBlocking {
        val fake = FakeHttpServer.start().also { server = it }
        fake.start {
            201 to validSuccessBody().put("status", "ACTIVE").toString().toByteArray()
        }

        try {
            withTimeout(5_000) { client(fake.baseUrl).bootstrap("t", "ANDROID", "s", "e", "attempt", "recovery") }
            fail("expected BootstrapError.AmbiguousOutcome")
        } catch (e: BootstrapError.AmbiguousOutcome) {
            // The server may have committed; retain the durable attempt and recover explicitly.
        }
    }

    @Test
    fun `a 201 missing deviceId is treated as ambiguous, never returned with a blank id`() = runBlocking {
        val fake = FakeHttpServer.start().also { server = it }
        fake.start {
            val body = validSuccessBody()
            body.remove("deviceId")
            201 to body.toString().toByteArray()
        }

        try {
            withTimeout(5_000) { client(fake.baseUrl).bootstrap("t", "ANDROID", "s", "e", "a", "r") }
            fail("expected BootstrapError.AmbiguousOutcome")
        } catch (e: BootstrapError.AmbiguousOutcome) {
            // expected
        }
    }

    @Test
    fun `bootstrap treats missing null blank unknown and non-string server profile fields as ambiguous`() = runBlocking {
        val responseBody = AtomicReference(validSuccessBody().toString())
        val fake = FakeHttpServer.start().also { server = it }
        fake.start { 201 to responseBody.get().toByteArray() }

        for (field in listOf("ageUxTier", "initialPolicyProfile")) {
            for (representation in listOf("missing", "null", "blank", "unknown", "number", "object")) {
                responseBody.set(malformedStringFieldBody(field, representation).toString())
                try {
                    withTimeout(5_000) {
                        client(fake.baseUrl).bootstrap("t", "ANDROID", "s", "e", "attempt", "recovery")
                    }
                    fail("expected ambiguous bootstrap for $field represented as $representation")
                } catch (_: BootstrapError.AmbiguousOutcome) {
                    // Keep the exact pending attempt and keys for status recovery.
                }
            }
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
            200 to validSuccessBody("recovered-device")
                .put("signingKeyId", "dsk-key-recovered")
                .put("encryptionKeyId", "dek-key-recovered")
                .put("ageUxTier", "YOUNG_CHILD")
                .put("initialPolicyProfile", "BALANCED")
                .toString().toByteArray()
        }

        val result = withTimeout(5_000) { client(fake.baseUrl).recoverAttempt("attempt-id-1", "recovery-token-1") }

        assertEquals(
            DeviceBootstrapResult(
                deviceId = "recovered-device",
                status = "PAIRING_PENDING",
                signingKeyId = "dsk-key-recovered",
                encryptionKeyId = "dek-key-recovered",
                ageUxTier = AgeUxTier.YOUNG_CHILD,
                initialPolicyProfile = InitialPolicyProfile.BALANCED,
            ),
            result,
        )
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

    @Test
    fun `recoverAttempt rejects a lifecycle state beyond PAIRING_PENDING as ambiguous`() = runBlocking {
        val fake = FakeHttpServer.start().also { server = it }
        fake.start {
            200 to validSuccessBody().put("status", "ACTIVE").toString().toByteArray()
        }

        try {
            withTimeout(5_000) { client(fake.baseUrl).recoverAttempt("attempt", "recovery") }
            fail("expected RecoveryError.AmbiguousOutcome")
        } catch (e: RecoveryError.AmbiguousOutcome) {
            // The original attempt remains unresolved and can be recovered later.
        }
    }

    @Test
    fun `bootstrap and recovery reject non-string identifiers and child profile ids`() = runBlocking {
        val responseBody = AtomicReference(validSuccessBody().toString())
        val statusCode = AtomicReference(201)
        val fake = FakeHttpServer.start().also { server = it }
        fake.start { statusCode.get() to responseBody.get().toByteArray() }

        for (field in listOf("deviceId", "status", "signingKeyId", "encryptionKeyId", "childProfileId")) {
            val invalidRepresentations = if (field == "childProfileId") {
                listOf("missing", "blank", "number", "object")
            } else {
                listOf("missing", "null", "blank", "number", "object")
            }
            for (representation in invalidRepresentations) {
                responseBody.set(malformedStringFieldBody(field, representation).toString())
                try {
                    withTimeout(5_000) {
                        client(fake.baseUrl).bootstrap("t", "ANDROID", "s", "e", "attempt", "recovery")
                    }
                    fail("expected ambiguous bootstrap for $field represented as $representation")
                } catch (_: BootstrapError.AmbiguousOutcome) {
                    // Non-string IDs cannot be coerced into a valid server DTO.
                }

                statusCode.set(200)
                try {
                    withTimeout(5_000) {
                        client(fake.baseUrl).recoverAttempt("attempt", "recovery")
                    }
                    fail("expected ambiguous recovery for $field represented as $representation")
                } catch (_: RecoveryError.AmbiguousOutcome) {
                    // Recovery must enforce the same exact DTO contract as bootstrap.
                } finally {
                    statusCode.set(201)
                }
            }
        }
    }

    @Test
    fun `recovery treats missing null blank unknown and non-string server profile fields as ambiguous`() = runBlocking {
        val responseBody = AtomicReference(validSuccessBody().toString())
        val fake = FakeHttpServer.start().also { server = it }
        fake.start { 200 to responseBody.get().toByteArray() }

        for (field in listOf("ageUxTier", "initialPolicyProfile")) {
            for (representation in listOf("missing", "null", "blank", "unknown", "number", "object")) {
                responseBody.set(malformedProfileBody(field, representation).toString())
                try {
                    withTimeout(5_000) {
                        client(fake.baseUrl).recoverAttempt("attempt", "recovery")
                    }
                    fail("expected ambiguous recovery for $field represented as $representation")
                } catch (_: RecoveryError.AmbiguousOutcome) {
                    // Keep the exact pending attempt and keys for another recovery attempt.
                }
            }
        }
    }
}
