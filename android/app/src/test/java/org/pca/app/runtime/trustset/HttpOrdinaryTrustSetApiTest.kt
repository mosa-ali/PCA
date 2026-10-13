package org.pca.app.runtime.trustset

import java.net.ServerSocket
import java.io.ByteArrayOutputStream
import java.nio.charset.CharacterCodingException
import java.nio.charset.StandardCharsets
import java.util.Base64
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.pca.app.runtime.sync.DeviceSessionManager
import org.pca.app.runtime.sync.FakeRelayHttpClient

class HttpOrdinaryTrustSetApiTest {
    private fun epoch(number: Int, issuedAt: String = "2026-10-09T00:00:00.000Z", keyEpoch: Int = 1) =
        UntrustedTrustSetEpoch("family", number, keyEpoch, listOf(UntrustedTrustSetEntry(
            "owner", TrustSetRole.OWNER, "dsk", "public-dsk", "dek", "public-dek", TrustSetMembershipStatus.ACTIVE)),
            issuedAt, if (number == 1) null else number - 1)

    private fun accepted(epoch: UntrustedTrustSetEpoch) = AcceptedEpochRecord(OrdinaryEpochRequest(
        Base64.getEncoder().encodeToString(TrustSetEpochCodec.canonicalize(epoch).toByteArray()),
        Base64.getEncoder().encodeToString(ByteArray(64) { epoch.trustSetEpoch.toByte() })),
        "owner", "dsk", epoch.trustSetEpoch, epoch.keyEpoch)

    private fun response(outcome: OrdinaryEpochOutcome, accepted: AcceptedEpochRecord?, head: AcceptedEpochRecord): String =
        JSONObject().put("outcome", outcome.name)
            .put("acceptedEpoch", accepted?.let(::recordJson) ?: JSONObject.NULL)
            .put("acceptedHead", recordJson(head)).toString()

    private fun recordJson(record: AcceptedEpochRecord) = JSONObject()
        .put("canonicalEpochBase64", record.request.canonicalEpochBase64)
        .put("signatureBase64", record.request.signatureBase64)
        .put("signerDeviceId", record.signerDeviceId)
        .put("signerKeyId", record.signerKeyId)
        .put("trustSetEpoch", record.trustSetEpoch)
        .put("keyEpoch", record.keyEpoch)

    private fun sessions() = DeviceSessionManager(
        FakeRelayHttpClient(), "owner", signer = { "test-signature" }, assertKeyCustody = {},
    )

    @Test fun `not accepted status carrying an accepted record is rejected as malformed`() = runBlocking {
        val pending = accepted(epoch(2))
        val root = accepted(epoch(1))
        val server = LocalServer(response(OrdinaryEpochOutcome.NOT_ACCEPTED, pending, root))
        try {
            val session = sessions().also { it.authenticate() }
            val api = HttpOrdinaryTrustSetApi(server.url, session, allowInsecureLocal = true)

            val failure = runCatching { api.status("family", pending.request) }.exceptionOrNull()

            assertTrue(failure is IllegalArgumentException)
            assertTrue(server.finished.await(2, TimeUnit.SECONDS))
            assertTrue(server.request.get().startsWith("POST /api/device/families/family/trust-set/epochs/status HTTP/1.1"))
        } finally {
            server.close()
        }
    }

    @Test fun `accepted status must identify the exact immutable request`() = runBlocking {
        val pending = accepted(epoch(2))
        val conflicting = accepted(epoch(2, "2026-10-09T00:01:00.000Z"))
        val server = LocalServer(response(OrdinaryEpochOutcome.ACCEPTED, conflicting, conflicting))
        try {
            val session = sessions().also { it.authenticate() }
            val api = HttpOrdinaryTrustSetApi(server.url, session, allowInsecureLocal = true)

            val failure = runCatching { api.status("family", pending.request) }.exceptionOrNull()

            assertTrue(failure is IllegalArgumentException)
            assertTrue(server.finished.await(2, TimeUnit.SECONDS))
        } finally {
            server.close()
        }
    }

    @Test fun `accepted status with exact request and matching head is valid`() = runBlocking {
        val pending = accepted(epoch(2))
        val server = LocalServer(response(OrdinaryEpochOutcome.ACCEPTED, pending, pending))
        try {
            val session = sessions().also { it.authenticate() }
            val api = HttpOrdinaryTrustSetApi(server.url, session, allowInsecureLocal = true)

            val result = api.status("family", pending.request)

            assertEquals(OrdinaryEpochOutcome.ACCEPTED, result.outcome)
            assertEquals(pending, result.acceptedEpoch)
            assertEquals(pending, result.acceptedHead)
            assertTrue(server.finished.await(2, TimeUnit.SECONDS))
        } finally {
            server.close()
        }
    }

    @Test fun `conflict status cannot carry an accepted record`() = runBlocking {
        val pending = accepted(epoch(2))
        val conflicting = accepted(epoch(2, "2026-10-09T00:01:00.000Z"))
        val root = accepted(epoch(1))
        val server = LocalServer(response(OrdinaryEpochOutcome.CONFLICT, conflicting, root))
        try {
            val session = sessions().also { it.authenticate() }
            val api = HttpOrdinaryTrustSetApi(server.url, session, allowInsecureLocal = true)

            val failure = runCatching { api.status("family", pending.request) }.exceptionOrNull()

            assertTrue(failure is IllegalArgumentException)
            assertTrue(server.finished.await(2, TimeUnit.SECONDS))
        } finally {
            server.close()
        }
    }

    @Test fun `conflict status with no accepted record is a valid non-mutating result`() = runBlocking {
        val pending = accepted(epoch(2))
        val root = accepted(epoch(1))
        val server = LocalServer(response(OrdinaryEpochOutcome.CONFLICT, null, root))
        try {
            val session = sessions().also { it.authenticate() }
            val api = HttpOrdinaryTrustSetApi(server.url, session, allowInsecureLocal = true)

            val result = api.status("family", pending.request)

            assertEquals(OrdinaryEpochOutcome.CONFLICT, result.outcome)
            assertEquals(null, result.acceptedEpoch)
            assertEquals(root, result.acceptedHead)
            assertTrue(server.finished.await(2, TimeUnit.SECONDS))
        } finally {
            server.close()
        }
    }

    @Test fun `accepted head cannot project a version older than the accepted record`() = runBlocking {
        val pending = accepted(epoch(2))
        val root = accepted(epoch(1))
        val server = LocalServer(response(OrdinaryEpochOutcome.ACCEPTED, pending, root))
        try {
            val session = sessions().also { it.authenticate() }
            val api = HttpOrdinaryTrustSetApi(server.url, session, allowInsecureLocal = true)

            val failure = runCatching { api.submit("family", pending.request) }.exceptionOrNull()

            assertTrue(failure is IllegalArgumentException)
            assertTrue(server.finished.await(2, TimeUnit.SECONDS))
        } finally {
            server.close()
        }
    }

    @Test fun `accepted head cannot project an older key epoch even with a newer trust set epoch`() = runBlocking {
        val pending = accepted(epoch(2, keyEpoch = 3))
        val newerTrustSetButOlderKeyEpoch = accepted(epoch(3, keyEpoch = 2))
        val server = LocalServer(response(OrdinaryEpochOutcome.ACCEPTED, pending, newerTrustSetButOlderKeyEpoch))
        try {
            val session = sessions().also { it.authenticate() }
            val api = HttpOrdinaryTrustSetApi(server.url, session, allowInsecureLocal = true)

            val failure = runCatching { api.submit("family", pending.request) }.exceptionOrNull()

            assertTrue(failure is IllegalArgumentException)
            assertTrue(server.finished.await(2, TimeUnit.SECONDS))
        } finally {
            server.close()
        }
    }

    @Test fun `accepted submit requires the exact immutable request`() = runBlocking {
        val pending = accepted(epoch(2))
        val conflicting = accepted(epoch(2, "2026-10-09T00:01:00.000Z"))
        val server = LocalServer(response(OrdinaryEpochOutcome.ACCEPTED, conflicting, conflicting))
        try {
            val session = sessions().also { it.authenticate() }
            val api = HttpOrdinaryTrustSetApi(server.url, session, allowInsecureLocal = true)

            val failure = runCatching { api.submit("family", pending.request) }.exceptionOrNull()

            assertTrue(failure is IllegalArgumentException)
            assertTrue(server.finished.await(2, TimeUnit.SECONDS))
        } finally {
            server.close()
        }
    }

    @Test fun `exact accepted submit is valid`() = runBlocking {
        val pending = accepted(epoch(2))
        val server = LocalServer(response(OrdinaryEpochOutcome.ACCEPTED, pending, pending))
        try {
            val session = sessions().also { it.authenticate() }
            val api = HttpOrdinaryTrustSetApi(server.url, session, allowInsecureLocal = true)

            val result = api.submit("family", pending.request)

            assertEquals(OrdinaryEpochOutcome.ACCEPTED, result.outcome)
            assertEquals(pending, result.acceptedEpoch)
            assertEquals(pending, result.acceptedHead)
            assertTrue(server.accepted.get())
            assertTrue(server.request.get().contains("content-type: application/json", ignoreCase = true))
            assertTrue(server.request.get().contains("content-length: ${server.requestBody.get()!!.size}", ignoreCase = true))
            val expectedBody = JSONObject().put("canonicalEpochBase64", pending.request.canonicalEpochBase64)
                .put("signatureBase64", pending.request.signatureBase64).toString().toByteArray(Charsets.UTF_8)
            assertArrayEquals(expectedBody, server.requestBody.get())
            assertEquals(setOf("canonicalEpochBase64", "signatureBase64"),
                JSONObject(server.requestBody.get()!!.toString(Charsets.UTF_8)).keys().asSequence().toSet())
            assertTrue(server.finished.await(2, TimeUnit.SECONDS))
        } finally {
            server.close()
        }
    }

    @Test fun `idempotent submit requires the exact immutable request`() = runBlocking {
        val pending = accepted(epoch(2))
        val conflicting = accepted(epoch(2, "2026-10-09T00:01:00.000Z"))
        val server = LocalServer(response(OrdinaryEpochOutcome.IDEMPOTENT_MATCH, conflicting, conflicting))
        try {
            val session = sessions().also { it.authenticate() }
            val api = HttpOrdinaryTrustSetApi(server.url, session, allowInsecureLocal = true)

            val failure = runCatching { api.submit("family", pending.request) }.exceptionOrNull()

            assertTrue(failure is IllegalArgumentException)
            assertTrue(server.finished.await(2, TimeUnit.SECONDS))
        } finally {
            server.close()
        }
    }

    @Test fun `exact idempotent submit is accepted when head matches accepted record`() = runBlocking {
        val pending = accepted(epoch(2))
        val server = LocalServer(response(OrdinaryEpochOutcome.IDEMPOTENT_MATCH, pending, pending))
        try {
            val session = sessions().also { it.authenticate() }
            val api = HttpOrdinaryTrustSetApi(server.url, session, allowInsecureLocal = true)

            val result = api.submit("family", pending.request)

            assertEquals(OrdinaryEpochOutcome.IDEMPOTENT_MATCH, result.outcome)
            assertEquals(pending, result.acceptedEpoch)
            assertEquals(pending, result.acceptedHead)
            assertTrue(server.finished.await(2, TimeUnit.SECONDS))
        } finally {
            server.close()
        }
    }

    @Test fun ordinaryHttpRequestLimitsAcceptExactInclusiveBoundaries() {
        assertEquals(196_506, OrdinaryEpochHttpRequestBounds.MAX_CANONICAL_BYTES)
        assertEquals(262_008, OrdinaryEpochHttpRequestBounds.MAX_CANONICAL_BASE64_CHARS)
        assertEquals(262_144, OrdinaryEpochHttpRequestBounds.MAX_JSON_BODY_BYTES)

        OrdinaryEpochHttpRequestBounds.requireCanonicalByteCount(196_506)
        OrdinaryEpochHttpRequestBounds.requireJsonBodyByteCount(262_144)

        assertTrue(runCatching { OrdinaryEpochHttpRequestBounds.requireCanonicalByteCount(196_507) }.isFailure)
        assertTrue(runCatching { OrdinaryEpochHttpRequestBounds.requireJsonBodyByteCount(262_145) }.isFailure)
    }

    @Test fun `submit rejects canonical bytes above ordinary backend limit before sending`() = runBlocking {
        val request = OrdinaryEpochRequest(
            Base64.getEncoder().encodeToString(ByteArray(OrdinaryEpochHttpRequestBounds.MAX_CANONICAL_BYTES + 1)),
            Base64.getEncoder().encodeToString(ByteArray(64)),
        )
        val acceptedEcho = AcceptedEpochRecord(request, "owner", "dsk", 2, 1)
        val server = LocalServer(response(OrdinaryEpochOutcome.ACCEPTED, acceptedEcho, acceptedEcho))
        try {
            val session = sessions().also { it.authenticate() }
            val api = HttpOrdinaryTrustSetApi(server.url, session, allowInsecureLocal = true)

            val failure = runCatching { api.submit("family", request) }.exceptionOrNull()

            assertTrue(failure is IllegalArgumentException)
            assertFalse("oversized request must be rejected before connecting", server.accepted.get())
        } finally {
            server.close()
        }
    }

    @Test fun `submit rejects noncanonical signature base64 before sending`() = runBlocking {
        val valid = accepted(epoch(2)).request
        val request = valid.copy(signatureBase64 = valid.signatureBase64.trimEnd('='))
        val acceptedEcho = AcceptedEpochRecord(request, "owner", "dsk", 2, 1)
        val server = LocalServer(response(OrdinaryEpochOutcome.ACCEPTED, acceptedEcho, acceptedEcho))
        try {
            val session = sessions().also { it.authenticate() }
            val api = HttpOrdinaryTrustSetApi(server.url, session, allowInsecureLocal = true)

            val failure = runCatching { api.submit("family", request) }.exceptionOrNull()

            assertTrue(failure is IllegalArgumentException)
            assertFalse("noncanonical signature must be rejected before connecting", server.accepted.get())
        } finally {
            server.close()
        }
    }

    @Test fun `valid not accepted status has no accepted record and preserves the projected head`() = runBlocking {
        val pending = accepted(epoch(2))
        val root = accepted(epoch(1))
        val server = LocalServer(response(OrdinaryEpochOutcome.NOT_ACCEPTED, null, root))
        try {
            val session = sessions().also { it.authenticate() }
            val api = HttpOrdinaryTrustSetApi(server.url, session, allowInsecureLocal = true)

            val result = api.status("family", pending.request)

            assertEquals(OrdinaryEpochOutcome.NOT_ACCEPTED, result.outcome)
            assertEquals(null, result.acceptedEpoch)
            assertEquals(root, result.acceptedHead)
            assertTrue(server.finished.await(2, TimeUnit.SECONDS))
        } finally {
            server.close()
        }
    }

    @Test fun `duplicate top level response members are rejected even when escape aliases match`() = runBlocking {
        val pending = accepted(epoch(2))
        val valid = response(OrdinaryEpochOutcome.ACCEPTED, pending, pending)
        val ambiguous = valid.replace(
            "\"outcome\":\"ACCEPTED\"",
            "\"outcome\":\"ACCEPTED\",\"outc\\u006fme\":\"CONFLICT\"",
        )
        val server = LocalServer(ambiguous)
        try {
            val session = sessions().also { it.authenticate() }
            val api = HttpOrdinaryTrustSetApi(server.url, session, allowInsecureLocal = true)

            val failure = runCatching { api.submit("family", pending.request) }.exceptionOrNull()

            assertTrue(failure is IllegalArgumentException)
            assertTrue(server.finished.await(2, TimeUnit.SECONDS))
        } finally {
            server.close()
        }
    }

    @Test fun `duplicate nested accepted record members are rejected`() = runBlocking {
        val pending = accepted(epoch(2))
        val valid = response(OrdinaryEpochOutcome.ACCEPTED, pending, pending)
        val acceptedRecord = recordJson(pending).toString()
        val duplicatedRecord = acceptedRecord.replace(
            "\"trustSetEpoch\":2",
            "\"trustSetEpoch\":2,\"trustSetEpoch\":2",
        )
        val ambiguous = valid.replace(acceptedRecord, duplicatedRecord)
        val server = LocalServer(ambiguous)
        try {
            val session = sessions().also { it.authenticate() }
            val api = HttpOrdinaryTrustSetApi(server.url, session, allowInsecureLocal = true)

            val failure = runCatching { api.submit("family", pending.request) }.exceptionOrNull()

            assertTrue(failure is IllegalArgumentException)
            assertTrue(server.finished.await(2, TimeUnit.SECONDS))
        } finally {
            server.close()
        }
    }

    @Test fun `duplicate accepted head members are rejected on the read only path`() = runBlocking {
        val head = accepted(epoch(2))
        val acceptedHead = recordJson(head).toString()
        val duplicatedHead = acceptedHead.replace(
            "\"keyEpoch\":1",
            "\"keyEpoch\":1,\"keyEpoch\":1",
        )
        val server = LocalServer("""{"acceptedHead":$duplicatedHead}""")
        try {
            val session = sessions().also { it.authenticate() }
            val api = HttpOrdinaryTrustSetApi(server.url, session, allowInsecureLocal = true)

            val failure = runCatching { api.getHead("family") }.exceptionOrNull()

            assertTrue(failure is IllegalArgumentException)
            assertTrue(server.finished.await(2, TimeUnit.SECONDS))
            assertTrue(server.request.get().startsWith("GET /api/device/families/family/trust-set/epochs/head HTTP/1.1"))
        } finally {
            server.close()
        }
    }

    @Test fun `successful submit rejects malformed UTF8 response bytes`() = runBlocking {
        val pending = accepted(epoch(2))
        val valid = response(OrdinaryEpochOutcome.ACCEPTED, pending, pending).toByteArray(Charsets.UTF_8)
        val malformed = insertMalformedUtf8(valid, "\"outcome\":\"".toByteArray(Charsets.US_ASCII).size + 1)
        val server = LocalServer(malformed)
        try {
            val session = sessions().also { it.authenticate() }
            val api = HttpOrdinaryTrustSetApi(server.url, session, allowInsecureLocal = true)

            val failure = runCatching { api.submit("family", pending.request) }.exceptionOrNull()

            assertTrue(failure is CharacterCodingException)
            assertTrue(server.finished.await(2, TimeUnit.SECONDS))
        } finally {
            server.close()
        }
    }

    @Test fun `read only accepted head rejects malformed UTF8 response bytes`() = runBlocking {
        val head = accepted(epoch(2))
        val valid = """{"acceptedHead":${recordJson(head)}}""".toByteArray(Charsets.UTF_8)
        val marker = "\"signerDeviceId\":\"".toByteArray(Charsets.US_ASCII)
        val markerStart = valid.indices.first { start ->
            start + marker.size <= valid.size && marker.indices.all { valid[start + it] == marker[it] }
        }
        val malformed = insertMalformedUtf8(valid, markerStart + marker.size)
        val server = LocalServer(malformed)
        try {
            val session = sessions().also { it.authenticate() }
            val api = HttpOrdinaryTrustSetApi(server.url, session, allowInsecureLocal = true)

            val failure = runCatching { api.getHead("family") }.exceptionOrNull()

            assertTrue(failure is CharacterCodingException)
            assertTrue(server.finished.await(2, TimeUnit.SECONDS))
        } finally {
            server.close()
        }
    }

    private fun insertMalformedUtf8(valid: ByteArray, offset: Int): ByteArray {
        val malformed = ByteArray(valid.size + 1)
        valid.copyInto(malformed, endIndex = offset)
        malformed[offset] = 0xC3.toByte() // invalid when followed by the original ASCII byte
        valid.copyInto(malformed, destinationOffset = offset + 1, startIndex = offset)
        return malformed
    }

    private class LocalServer(private val body: ByteArray) {
        constructor(body: String) : this(body.toByteArray(Charsets.UTF_8))

        private val socket = ServerSocket(0)
        val url = "http://127.0.0.1:${socket.localPort}"
        val request = AtomicReference("")
        val requestBody = AtomicReference<ByteArray?>(null)
        val accepted = AtomicBoolean(false)
        val finished = CountDownLatch(1)

        fun close() = socket.close()

        init {
            Thread {
                try {
                    socket.soTimeout = 5000
                    socket.accept().use { client ->
                        accepted.set(true)
                        val input = client.getInputStream()
                        val lines = mutableListOf<String>()
                        while (true) {
                            val line = readAsciiLine(input) ?: break
                            if (line.isEmpty()) break
                            lines += line
                        }
                        request.set(lines.joinToString("\n"))
                        val contentLength = lines.firstNotNullOfOrNull { line ->
                            Regex("(?i)^content-length:\\s*([0-9]+)$").matchEntire(line)?.groupValues?.get(1)?.toIntOrNull()
                        } ?: 0
                        val payload = input.readNBytes(contentLength)
                        require(payload.size == contentLength) { "incomplete request body" }
                        requestBody.set(payload)
                        val header = "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${body.size}\r\nConnection: close\r\n\r\n"
                        client.getOutputStream().apply {
                            write(header.toByteArray(StandardCharsets.US_ASCII))
                            write(body)
                            flush()
                        }
                    }
                } catch (_: java.net.SocketException) {
                    // A test may close the server during teardown if the client rejects input early.
                } finally {
                    finished.countDown()
                    socket.close()
                }
            }.apply { isDaemon = true; start() }
        }

        private fun readAsciiLine(input: java.io.InputStream): String? {
            val bytes = ByteArrayOutputStream()
            while (true) {
                val next = input.read()
                if (next < 0) return if (bytes.size() == 0) null else bytes.toString(StandardCharsets.US_ASCII)
                if (next == '\n'.code) {
                    val line = bytes.toByteArray()
                    val length = if (line.lastOrNull() == '\r'.code.toByte()) line.size - 1 else line.size
                    return String(line, 0, length, StandardCharsets.US_ASCII)
                }
                bytes.write(next)
            }
        }
    }
}
