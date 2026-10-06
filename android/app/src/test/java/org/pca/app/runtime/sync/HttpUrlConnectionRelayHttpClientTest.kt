package org.pca.app.runtime.sync

import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import org.pca.app.runtime.sync.transport.HttpUrlConnectionRelayHttpClient
import org.pca.app.runtime.sync.transport.InboundListResult
import org.pca.app.runtime.sync.transport.RelayHttpErrorCode
import org.pca.app.runtime.sync.transport.RelayHttpException

/**
 * The relay transport carries device session tokens and family-sync envelopes, so its base URL
 * gets the SAME construction-time scheme guard the enrollment transport already applies
 * (org.pca.app.enrollment.BootstrapEndpointConfig): HTTPS always, plain HTTP only for a
 * well-known local development host and only with an explicit opt-in. Guarding it here means a
 * future wiring site cannot silently downgrade the channel -- the misconfiguration fails closed
 * at composition time instead of on the wire.
 */
class HttpUrlConnectionRelayHttpClientTest {
    @Test
    fun `inbound continuation parses as boolean and legacy deferred ids remain pending`() = kotlinx.coroutines.test.runTest {
        val base = """{"scope":{"familyId":"family-1","recipientDeviceId":"device-1"},"applied":[],"unparseableMessageIds":[],"droppedForListBound":[]"""

        org.junit.Assert.assertTrue(readInboundResponse("$base,\"hasMore\":true}").hasMore)
        org.junit.Assert.assertFalse(readInboundResponse("$base,\"hasMore\":false}").hasMore)
        org.junit.Assert.assertFalse(readInboundResponse("$base}").hasMore)
        val legacyDeferred = base.replace("\"droppedForListBound\":[]", "\"droppedForListBound\":[\"deferred-1\"]")
        org.junit.Assert.assertTrue(readInboundResponse("$legacyDeferred}").hasMore)

        for (value in listOf("null", "\"true\"", "1")) {
            try {
                readInboundResponse("$base,\"hasMore\":$value}")
                fail("Expected malformed continuation value '$value' to be rejected")
            } catch (e: RelayHttpException) {
                org.junit.Assert.assertTrue(e.errorCode is RelayHttpErrorCode.InvalidRequest)
            }
        }
    }

    @Test
    fun `ack encodes protocol legal opaque id as one HTTP path component`() = kotlinx.coroutines.test.runTest {
        val server = java.net.ServerSocket(0, 3, java.net.InetAddress.getByName("127.0.0.1"))
        val paths = java.util.Collections.synchronizedList(mutableListOf<String>())
        val thread = Thread {
            repeat(3) {
                server.accept().use { socket ->
                    socket.soTimeout = 5000
                    val reader = socket.getInputStream().bufferedReader()
                    paths.add(reader.readLine().split(" ")[1])
                    while (!reader.readLine().isNullOrEmpty()) { }
                    socket.getOutputStream().write("HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}".toByteArray())
                    socket.getOutputStream().flush()
                }
            }
        }
        thread.isDaemon = true
        thread.start()
        try {
            val client = HttpUrlConnectionRelayHttpClient("http://127.0.0.1:${server.localPort}", allowInsecureHttp = true)
            for ((id, encoded) in listOf("a/b?c#d%e" to "a%2Fb%3Fc%23d%25e", "." to "%2E", ".." to "%2E%2E")) {
                client.acknowledgeInbound("session-token", id)
                org.junit.Assert.assertEquals("/v1/runtime-sync/inbound/$encoded/ack", paths.last())
            }
        } finally { server.close(); thread.join(1000) }
    }

    private suspend fun readInboundResponse(body: String): InboundListResult {
        val server = java.net.ServerSocket(0, 1, java.net.InetAddress.getByName("127.0.0.1"))
        val thread = Thread {
            server.accept().use { socket ->
                socket.soTimeout = 5000
                val reader = socket.getInputStream().bufferedReader()
                reader.readLine()
                while (!reader.readLine().isNullOrEmpty()) { }
                val payload = body.toByteArray(Charsets.UTF_8)
                val output = socket.getOutputStream()
                output.write("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${payload.size}\r\nConnection: close\r\n\r\n".toByteArray())
                output.write(payload)
                output.flush()
            }
        }
        thread.isDaemon = true
        thread.start()
        return try {
            HttpUrlConnectionRelayHttpClient("http://127.0.0.1:${server.localPort}", allowInsecureHttp = true)
                .listInbound("session-token")
        } finally {
            server.close()
            thread.join(1000)
        }
    }
    @Test
    fun `response streaming stops at byte bound before JSON parsing`() {
        val bytes = "12345".byteInputStream()
        try {
            org.pca.app.runtime.sync.transport.readBoundedResponse(bytes, maxBytes = 4)
            fail("Expected bounded response rejection")
        } catch (_: org.pca.app.runtime.sync.transport.RelayHttpException) { }
        org.junit.Assert.assertEquals("1234", org.pca.app.runtime.sync.transport.readBoundedResponse("1234".byteInputStream(), maxBytes = 4))
    }
    @Test
    fun `production config refuses plain http against a non-local host`() {
        try {
            HttpUrlConnectionRelayHttpClient(baseUrl = "http://relay.pca.app")
            fail("expected IllegalArgumentException")
        } catch (e: IllegalArgumentException) {
            assertTrue(e.message?.contains("Refusing") == true)
        }
    }

    @Test
    fun `https is always accepted regardless of host`() {
        HttpUrlConnectionRelayHttpClient(baseUrl = "https://relay.pca.app")
        HttpUrlConnectionRelayHttpClient(baseUrl = "https://10.0.2.2:8443")
    }

    @Test
    fun `plain http is accepted only for local dev hosts, and only opted in`() {
        try {
            HttpUrlConnectionRelayHttpClient(baseUrl = "http://127.0.0.1:8080", allowInsecureHttp = false)
            fail("expected IllegalArgumentException")
        } catch (e: IllegalArgumentException) {
            // expected: a local host alone is not enough without the explicit opt-in
        }
        HttpUrlConnectionRelayHttpClient(baseUrl = "http://127.0.0.1:8080", allowInsecureHttp = true)
        HttpUrlConnectionRelayHttpClient(baseUrl = "http://localhost:8080", allowInsecureHttp = true)
        HttpUrlConnectionRelayHttpClient(baseUrl = "http://10.0.2.2:8080", allowInsecureHttp = true)
    }

    @Test
    fun `the insecure opt-in never promotes a non-local host, and never accepts a non-http scheme`() {
        for (baseUrl in listOf(
            "http://relay.pca.app",
            "http://evil.example.com",
            // Not a local host: "localhost" only as a userinfo/prefix, real host is elsewhere.
            "http://localhost.attacker.example",
            "ftp://relay.pca.app",
            "file:///data/local/tmp",
            "relay.pca.app",
            "",
        )) {
            try {
                HttpUrlConnectionRelayHttpClient(baseUrl = baseUrl, allowInsecureHttp = true)
                fail("expected IllegalArgumentException for '$baseUrl'")
            } catch (e: IllegalArgumentException) {
                // expected
            }
        }
    }
}
