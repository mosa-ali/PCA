package org.pca.app.runtime.sync

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class DeviceSessionManagerTest {

    @Test
    fun `requireSessionToken authenticates on first use`() = runTest {
        val relay = FakeRelayHttpClient()
        var signedNonce: String? = null
        val manager = DeviceSessionManager(relay, "device-1", signer = { nonce -> signedNonce = nonce; "sig-1" }, nowEpochMillis = { 0L })

        val token = manager.requireSessionToken()

        assertEquals("session-for-device-1", token)
        assertEquals("nonce-for-device-1", signedNonce)
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
        val manager = DeviceSessionManager(countingRelay, "device-1", signer = { "sig-1" }, nowEpochMillis = { 0L })

        manager.requireSessionToken()
        manager.requireSessionToken()

        assertEquals(1, challengeCalls)
    }

    @Test
    fun `isAuthenticated is false before the first authenticate call`() {
        val relay = FakeRelayHttpClient()
        val manager = DeviceSessionManager(relay, "device-1", signer = { "sig-1" })
        assertTrue(!manager.isAuthenticated())
    }
}
