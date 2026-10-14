package org.pca.app.runtime.sync

import java.time.Instant
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class DeviceSessionManagerTest {
    @Test fun `old rejected token cannot invalidate a replacement session`() = runTest {
        val relay = FakeRelayHttpClient()
        var sequence = 0
        val sessionTokens = listOf("A".repeat(43), "A".repeat(42) + "E", "A".repeat(42) + "I")
        val transport = object : org.pca.app.runtime.sync.transport.RelayHttpClient by relay {
            override suspend fun completeChallenge(deviceId: String, challengeId: String, signature: String) =
                relay.completeChallenge(deviceId, challengeId, signature).copy(sessionToken = sessionTokens[sequence++])
        }
        val manager = DeviceSessionManager(transport, "device-1", signer = { "sig" }, assertKeyCustody = {})
        val old = manager.authenticate().sessionToken
        val replacement = manager.authenticate().sessionToken
        manager.invalidateRejectedSession(old)
        assertEquals(replacement, manager.requireSessionToken())
        assertEquals(2, sequence)
        manager.invalidateRejectedSession(replacement)
        assertEquals(sessionTokens[2], manager.requireSessionToken())
    }

    @Test fun `custody loss during challenge prevents signing or session exchange`() = runTest {
        val relay = FakeRelayHttpClient()
        var custodyAvailable = true
        var signingCalls = 0
        var exchangeCalls = 0
        val interrupted = object : org.pca.app.runtime.sync.transport.RelayHttpClient by relay {
            override suspend fun issueChallenge(deviceId: String) = relay.issueChallenge(deviceId).also { custodyAvailable = false }
            override suspend fun completeChallenge(deviceId: String, challengeId: String, signature: String): org.pca.app.runtime.sync.transport.DeviceSessionInfo {
                exchangeCalls++
                return relay.completeChallenge(deviceId, challengeId, signature)
            }
        }
        val manager = DeviceSessionManager(interrupted, "device-1", signer = { signingCalls++; "sig" },
            assertKeyCustody = { check(custodyAvailable) })
        assertTrue(runCatching { manager.authenticate() }.isFailure)
        assertEquals(0, signingCalls)
        assertEquals(0, exchangeCalls)
        assertTrue(!manager.isAuthenticated())
    }

    @Test fun `custody loss during signing prevents session exchange`() = runTest {
        val relay = FakeRelayHttpClient()
        var custodyAvailable = true
        var exchangeCalls = 0
        val observing = object : org.pca.app.runtime.sync.transport.RelayHttpClient by relay {
            override suspend fun completeChallenge(deviceId: String, challengeId: String, signature: String): org.pca.app.runtime.sync.transport.DeviceSessionInfo {
                exchangeCalls++
                return relay.completeChallenge(deviceId, challengeId, signature)
            }
        }
        val manager = DeviceSessionManager(observing, "device-1", signer = { custodyAvailable = false; "sig" },
            assertKeyCustody = { check(custodyAvailable) })
        assertTrue(runCatching { manager.authenticate() }.isFailure)
        assertEquals(0, exchangeCalls)
        assertTrue(!manager.isAuthenticated())
    }
    @Test fun `runtime challenge composition encodes already canonical provider bytes once`() {
        val canonical = ByteArray(64) { (it + 1).toByte() }
        val engine = object : org.pca.app.security.DskSignatureEngine {
            override fun signCanonicalDer(alias: String, message: ByteArray): ByteArray {
                assertEquals("original-dsk-alias", alias)
                assertEquals("server-nonce", String(message, Charsets.UTF_8))
                return canonical
            }
        }
        val encoded = signRuntimeDeviceChallenge(engine, "original-dsk-alias", "server-nonce")
        org.junit.Assert.assertArrayEquals(canonical, java.util.Base64.getUrlDecoder().decode(encoded))
    }

    @Test
    fun `key loss invalidates cached session and never returns bearer token`() = runTest {
        var keyAvailable = true
        val manager = DeviceSessionManager(FakeRelayHttpClient(), "device-1", signer = { "sig-1" },
            assertKeyCustody = { check(keyAvailable) })
        manager.requireSessionToken()
        assertTrue(manager.isAuthenticated())
        keyAvailable = false
        assertTrue(runCatching { manager.requireSessionToken() }.isFailure)
        assertTrue(!manager.isAuthenticated())
    }

    @Test
    fun `isAuthenticated rejects a cached session after key custody is lost`() = runTest {
        val delegate = FakeRelayHttpClient()
        var challengeCalls = 0
        val relay = object : org.pca.app.runtime.sync.transport.RelayHttpClient by delegate {
            override suspend fun issueChallenge(deviceId: String): org.pca.app.runtime.sync.transport.ChallengeResponse {
                challengeCalls += 1
                return delegate.issueChallenge(deviceId)
            }
        }
        var keyAvailable = true
        val manager = DeviceSessionManager(
            relay,
            "device-1",
            signer = { "sig-1" },
            assertKeyCustody = { check(keyAvailable) },
        )
        manager.requireSessionToken()
        assertEquals(1, challengeCalls)
        assertTrue(manager.isAuthenticated())

        keyAvailable = false

        assertTrue(!manager.isAuthenticated())

        keyAvailable = true
        manager.requireSessionToken()
        assertEquals(2, challengeCalls)
    }

    @Test
    fun `requireSessionToken authenticates on first use`() = runTest {
        val relay = FakeRelayHttpClient()
        var signedNonce: String? = null
        val manager = DeviceSessionManager(
            relay,
            "device-1",
            signer = { nonce -> signedNonce = nonce; "sig-1" },
            assertKeyCustody = {},
            nowEpochMillis = { 0L },
        )

        val token = manager.requireSessionToken()

        assertEquals("A".repeat(43), token)
        assertEquals("nonce-for-device-1", signedNonce)
    }

    @Test
    fun `malformed token response is rejected and not cached`() = runTest {
        val delegate = FakeRelayHttpClient()
        var challengeCalls = 0
        var completionCalls = 0
        val transport = object : org.pca.app.runtime.sync.transport.RelayHttpClient by delegate {
            override suspend fun issueChallenge(deviceId: String): org.pca.app.runtime.sync.transport.ChallengeResponse {
                challengeCalls++
                return delegate.issueChallenge(deviceId)
            }

            override suspend fun completeChallenge(deviceId: String, challengeId: String, signature: String) =
                delegate.completeChallenge(deviceId, challengeId, signature).let {
                    completionCalls++
                    if (completionCalls == 1) it.copy(sessionToken = "malformed-token") else it
                }
        }
        val manager = DeviceSessionManager(transport, "device-1", signer = { "sig" }, assertKeyCustody = {}, nowEpochMillis = { 0L })

        assertTrue(runCatching { manager.requireSessionToken() }.isFailure)
        assertTrue(!manager.isAuthenticated())
        assertEquals(1, challengeCalls)
        assertEquals("A".repeat(43), manager.requireSessionToken())
        assertEquals(2, challengeCalls)
    }

    @Test
    fun `malformed and expired session expiry responses are rejected and not cached`() = runTest {
        val delegate = FakeRelayHttpClient()
        val responses = ArrayDeque(
            listOf(
                delegate.completeChallenge("device-1", "challenge", "sig").copy(expiresAt = "not-an-iso-instant"),
                delegate.completeChallenge("device-1", "challenge", "sig").copy(expiresAt = Instant.ofEpochMilli(1_000L).toString()),
                delegate.completeChallenge("device-1", "challenge", "sig").copy(expiresAt = Instant.ofEpochMilli(1_001L).toString()),
            ),
        )
        var challengeCalls = 0
        val transport = object : org.pca.app.runtime.sync.transport.RelayHttpClient by delegate {
            override suspend fun issueChallenge(deviceId: String): org.pca.app.runtime.sync.transport.ChallengeResponse {
                challengeCalls++
                return delegate.issueChallenge(deviceId)
            }

            override suspend fun completeChallenge(deviceId: String, challengeId: String, signature: String) = responses.removeFirst()
        }
        val manager = DeviceSessionManager(transport, "device-1", signer = { "sig" }, assertKeyCustody = {}, nowEpochMillis = { 1_000L })

        assertTrue(runCatching { manager.requireSessionToken() }.isFailure)
        assertTrue(!manager.isAuthenticated())
        assertTrue(runCatching { manager.requireSessionToken() }.isFailure)
        assertTrue(!manager.isAuthenticated())
        assertEquals("A".repeat(43), manager.requireSessionToken())
        assertTrue(manager.isAuthenticated())
        assertEquals(3, challengeCalls)
    }

    @Test
    fun `an already-authenticated, unexpired session is reused rather than re-authenticating`() = runTest {
        val relay = FakeRelayHttpClient()
        var challengeCalls = 0
        val countingRelay = object : org.pca.app.runtime.sync.transport.RelayHttpClient by relay {
            override suspend fun issueChallenge(deviceId: String): org.pca.app.runtime.sync.transport.ChallengeResponse {
                challengeCalls += 1
                return relay.issueChallenge(deviceId)
            }
        }
        val manager = DeviceSessionManager(
            countingRelay,
            "device-1",
            signer = { "sig-1" },
            assertKeyCustody = {},
            nowEpochMillis = { 0L },
        )

        manager.requireSessionToken()
        manager.requireSessionToken()

        assertEquals(1, challengeCalls)
    }

    @Test
    fun `isAuthenticated is false before the first authenticate call`() {
        val relay = FakeRelayHttpClient()
        val manager = DeviceSessionManager(relay, "device-1", signer = { "sig-1" }, assertKeyCustody = {})
        assertTrue(!manager.isAuthenticated())
    }
}
