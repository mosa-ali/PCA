package org.pca.app.runtime.sync

import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import org.pca.app.runtime.sync.transport.HttpUrlConnectionRelayHttpClient

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
