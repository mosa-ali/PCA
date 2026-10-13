package org.pca.app.firstdevice

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
