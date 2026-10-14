package org.pca.app.firstdevice

import java.io.ByteArrayOutputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketTimeoutException
import java.nio.charset.StandardCharsets
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.fail
import org.junit.Test
import org.pca.app.enrollment.BootstrapEndpointConfig
import org.pca.app.enrollment.FakeHttpServer

class FirstDeviceBootstrapApiClientTest {
    private val validChallenge = """{"status":"PENDING","ceremonyId":"ceremony-1","challengeId":"challenge-1","nonce":"nonce-1","expiresAt":"2026-10-13T12:00:00.000Z","familyId":"family-1","deviceId":"device-1"}"""
    private var server: FakeHttpServer? = null

    @After
    fun tearDown() {
        server?.stop()
    }

    @Test
    fun `challenge parser accepts the exact server pending DTO`() {
        val result = parseFirstDeviceChallenge(validChallenge)

        assertEquals("ceremony-1", result.ceremonyId)
        assertEquals("challenge-1", result.challengeId)
        assertEquals("nonce-1", result.nonce)
        assertEquals("2026-10-13T12:00:00.000Z", result.expiresAt)
        assertEquals("family-1", result.familyId)
        assertEquals("device-1", result.deviceId)
    }

    @Test
    fun `challenge parser rejects coerced fields missing fields and unrecognized status`() {
        val invalidBodies = listOf(
            validChallenge.replace("\"challengeId\":\"challenge-1\"", "\"challengeId\":123"),
            validChallenge.replace("\"familyId\":\"family-1\"", "\"familyId\":null"),
            validChallenge.replace(",\"deviceId\":\"device-1\"", ""),
            validChallenge.replace("\"status\":\"PENDING\"", "\"status\":\"APPROVED\""),
            validChallenge.replace("\"status\":\"PENDING\"", "\"status\":123"),
            validChallenge.replace("\"deviceId\":\"device-1\"", "\"deviceId\":\"device-1\",\"extra\":true"),
            validChallenge.replace("\"deviceId\":\"device-1\"", "\"deviceId\":\"attacker\",\"deviceId\":\"device-1\""),
        )

        for (body in invalidBodies) {
            try {
                parseFirstDeviceChallenge(body)
                fail("malformed challenge DTO was accepted")
            } catch (_: FirstDeviceBootstrapError.AmbiguousOutcome) {
                // The ceremony remains unresolved; callers must use the status endpoint.
            }
        }
    }

    @Test
    fun `submit parser accepts only the exact accepted DTO`() {
        assertEquals("ACCEPTED", parseFirstDeviceSubmitResponse("""{"status":"ACCEPTED"}""").status)

        val invalidBodies = listOf(
            "{}",
            """{"status":"ACCEPTED","extra":true}""",
            """{"status":"ACCEPTED","status":"ACCEPTED"}""",
            """{"status":1}""",
            """{"status":null}""",
            """{"status":"PENDING"}""",
        )
        assertAmbiguousBodies(invalidBodies, ::parseFirstDeviceSubmitResponse)
    }

    @Test
    fun `trailing slash origin produces the canonical first device endpoint path`() = runBlocking {
        val requestedPath = AtomicReference<String?>(null)
        val fake = FakeHttpServer.start().also { server = it }
        fake.startRequest { request ->
            requestedPath.set(request.path)
            200 to validChallenge.toByteArray(StandardCharsets.UTF_8)
        }
        val api = HttpFirstDeviceBootstrapApiClient(
            BootstrapEndpointConfig("${fake.baseUrl}/", allowInsecureHttp = true),
            connectTimeoutMillis = 2_000,
            readTimeoutMillis = 2_000,
        )

        withTimeout(5_000) { api.challenge("attempt", "recovery", "dsk", "public-key") }

        assertEquals(HttpFirstDeviceBootstrapApiClient.CHALLENGE_PATH, requestedPath.get())
    }

    @Test
    fun `status parser accepts only exact service-consistent status and outcome combinations`() {
        val valid = listOf(
            """{"status":"PENDING","outcome":null}""" to ("PENDING" to null),
            """{"status":"APPROVED","outcome":null}""" to ("APPROVED" to null),
            """{"status":"EXPIRED","outcome":null}""" to ("EXPIRED" to null),
            """{"status":"COMMITTED","outcome":null}""" to ("COMMITTED" to null),
            """{"status":"COMMITTED","outcome":"ACCEPTED"}""" to ("COMMITTED" to "ACCEPTED"),
        )
        for ((body, expected) in valid) {
            val result = parseFirstDeviceStatusResponse(body)
            assertEquals(expected.first, result.status)
            assertEquals(expected.second, result.outcome)
        }

        val invalidBodies = listOf(
            "{}",
            """{"status":"PENDING"}""",
            """{"status":"PENDING","outcome":null,"extra":false}""",
            """{"status":"PENDING","status":"PENDING","outcome":null}""",
            """{"status":"PENDING","outcome":null,"outcome":null}""",
            """{"status":1,"outcome":null}""",
            """{"status":null,"outcome":null}""",
            """{"status":"UNKNOWN","outcome":null}""",
            """{"status":"PENDING","outcome":1}""",
            """{"status":"PENDING","outcome":"ACCEPTED"}""",
            """{"status":"APPROVED","outcome":"ACCEPTED"}""",
            """{"status":"EXPIRED","outcome":"ACCEPTED"}""",
            """{"status":"COMMITTED","outcome":"REJECTED"}""",
        )
        assertAmbiguousBodies(invalidBodies, ::parseFirstDeviceStatusResponse)
    }

    @Test
    fun `raw malformed UTF-8 in every first-device success body remains ambiguous`() = runBlocking {
        val response = AtomicReference(byteArrayOf())
        val fake = FakeHttpServer.start().also { server = it }
        fake.start { response.get().let { 200 to it } }
        val api = HttpFirstDeviceBootstrapApiClient(
            BootstrapEndpointConfig(fake.baseUrl, allowInsecureHttp = true),
            connectTimeoutMillis = 2_000,
            readTimeoutMillis = 2_000,
        )
        val malformedJsonString = { prefix: String ->
            prefix.toByteArray(Charsets.UTF_8) + byteArrayOf(0xc3.toByte(), 0x28.toByte()) + "\"}".toByteArray()
        }

        response.set(malformedJsonString("""{"status":"PENDING","ceremonyId":"ceremony-1","challengeId":"challenge-1","nonce":"nonce-1","expiresAt":"2026-10-13T12:00:00.000Z","familyId":"family-1","deviceId":"device-1","padding":"""))
        assertAmbiguousOutcome {
            withTimeout(5_000) { api.challenge("attempt", "recovery", "dsk", "public-key") }
        }

        response.set(malformedJsonString("""{"status":"ACCEPTED","x":"""))
        assertAmbiguousOutcome {
            withTimeout(5_000) {
                api.submit("attempt", "recovery", "ceremony", "proof", "signature", "epoch", "signature", "evidence")
            }
        }

        response.set(malformedJsonString("""{"status":"COMMITTED","outcome":"ACCEPTED","extra":"""))
        assertAmbiguousOutcome {
            withTimeout(5_000) { api.status("attempt", "recovery", "ceremony") }
        }
    }

    @Test
    fun `credential bearing bootstrap posts never follow redirects`() = runBlocking {
        for (status in listOf(301, 302, 307, 308)) {
            val target = ServerSocket(0, 4, InetAddress.getByName("127.0.0.1")).apply { soTimeout = 1_500 }
            val redirector = ServerSocket(0, 4, InetAddress.getByName("127.0.0.1")).apply { soTimeout = 3_000 }
            val targetRequests = AtomicInteger()
            val serverFailure = AtomicReference<Throwable?>(null)
            val targetThread = Thread {
                try {
                    target.accept().use { socket ->
                        targetRequests.incrementAndGet()
                        readHttpRequest(socket)
                        writeHttpResponse(socket, 200, """{"status":"ACCEPTED"}""")
                    }
                } catch (_: SocketTimeoutException) {
                    // Expected when the client refuses the redirect.
                } catch (failure: Throwable) {
                    serverFailure.set(failure)
                }
            }.apply { isDaemon = true; start() }
            val redirectThread = Thread {
                try {
                    redirector.accept().use { socket ->
                        readHttpRequest(socket)
                        val location = "http://127.0.0.1:${target.localPort}/stolen"
                        val reason = when (status) {
                            301 -> "Moved Permanently"
                            302 -> "Found"
                            307 -> "Temporary Redirect"
                            else -> "Permanent Redirect"
                        }
                        val response = "HTTP/1.1 $status $reason\r\n" +
                            "Location: $location\r\n" +
                            "Content-Length: 0\r\n" +
                            "Connection: close\r\n\r\n"
                        socket.getOutputStream().apply {
                            write(response.toByteArray(StandardCharsets.US_ASCII))
                            flush()
                        }
                    }
                } catch (failure: Throwable) {
                    serverFailure.set(failure)
                }
            }.apply { isDaemon = true; start() }

            try {
                val api = HttpFirstDeviceBootstrapApiClient(
                    BootstrapEndpointConfig("http://127.0.0.1:${redirector.localPort}", allowInsecureHttp = true),
                    connectTimeoutMillis = 2_000,
                    readTimeoutMillis = 2_000,
                )
                try {
                    withTimeout(5_000) {
                        api.submit("attempt-secret", "recovery-secret", "ceremony", "proof", "proof-signature",
                            "epoch-bytes", "epoch-signature", "attestation-evidence")
                    }
                    fail("HTTP $status must not be followed or accepted as a bootstrap result")
                } catch (expected: FirstDeviceBootstrapError.UnexpectedServerError) {
                    // Redirects are rejected as server errors; the sensitive POST body stays at the configured origin.
                }
                redirectThread.join(3_000)
                targetThread.join(2_000)
                assertEquals("redirect target received the POST body for status $status", 0, targetRequests.get())
                assertEquals(null, serverFailure.get())
            } finally {
                redirector.close()
                target.close()
                redirectThread.join(500)
                targetThread.join(500)
            }
        }
    }

    private fun readHttpRequest(socket: Socket) {
        val input = socket.getInputStream()
        val headers = mutableListOf<String>()
        while (true) {
            val line = readAsciiLine(input) ?: return
            if (line.isEmpty()) break
            headers += line
        }
        val contentLength = headers.firstOrNull { it.startsWith("Content-Length:", ignoreCase = true) }
            ?.substringAfter(':')?.trim()?.toIntOrNull() ?: 0
        var remaining = contentLength
        while (remaining > 0) {
            val read = input.read()
            if (read == -1) return
            remaining--
        }
    }

    private fun readAsciiLine(input: java.io.InputStream): String? {
        val line = ByteArrayOutputStream()
        while (true) {
            val value = input.read()
            if (value == -1) return if (line.size() == 0) null else line.toString(StandardCharsets.US_ASCII.name())
            if (value == '\n'.code) {
                val bytes = line.toByteArray()
                val length = if (bytes.lastOrNull() == '\r'.code.toByte()) bytes.size - 1 else bytes.size
                return String(bytes, 0, length, StandardCharsets.US_ASCII)
            }
            line.write(value)
        }
    }

    private fun writeHttpResponse(socket: Socket, status: Int, body: String) {
        val bytes = body.toByteArray(StandardCharsets.UTF_8)
        val headers = "HTTP/1.1 $status OK\r\nContent-Type: application/json\r\n" +
            "Content-Length: ${bytes.size}\r\nConnection: close\r\n\r\n"
        socket.getOutputStream().apply {
            write(headers.toByteArray(StandardCharsets.US_ASCII))
            write(bytes)
            flush()
        }
    }

    private fun <T> assertAmbiguousBodies(bodies: List<String>, parse: (String) -> T) {
        for (body in bodies) assertAmbiguousParser { parse(body) }
    }

    private fun assertAmbiguousParser(action: () -> Any?) {
        try {
            action()
            fail("malformed success response was accepted")
        } catch (_: FirstDeviceBootstrapError.AmbiguousOutcome) {
            // Preserve ambiguity and require status reconciliation; never infer success.
        }
    }

    private suspend fun assertAmbiguousOutcome(action: suspend () -> Any?) {
        try {
            action()
            fail("malformed success response was accepted")
        } catch (_: FirstDeviceBootstrapError.AmbiguousOutcome) {
            // Preserve ambiguity and require status reconciliation; never infer success.
        }
    }
}
