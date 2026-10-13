package org.pca.app.runtime.location.geofence

import java.net.ServerSocket
import java.nio.charset.StandardCharsets
import java.io.IOException
import java.net.SocketException
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.Assert.*
import org.junit.Test
import org.pca.app.foundation.InMemoryPersistentStateStore
import org.pca.app.foundation.PersistentStateStore
import org.pca.app.runtime.sync.DeviceSessionManager
import org.pca.app.runtime.sync.FakeRelayHttpClient
import org.pca.app.runtime.sync.transport.RelayHttpClient

class SafeZoneDeliveryClientTest {
    private fun sessions(relay: RelayHttpClient = FakeRelayHttpClient()) =
        DeviceSessionManager(relay, "device-1", signer = { "test-signature" }, assertKeyCustody = {})

    @Test fun `fetches only the authenticated opaque delivery contract and stages it durably by local scope`() = runBlocking {
        val response = page(listOf(row("zone-1", revision = 4294967295L)), null)
        val server = LocalServer(200, response)
        val session = sessions()
        session.authenticate()
        val rows = HttpSafeZoneDeliveryClient(server.url, session, allowInsecureLocal = true).fetch()
        assertTrue(server.finished.await(2, TimeUnit.SECONDS))
        assertTrue(server.request.get().startsWith("GET /v1/runtime-sync/safe-zones HTTP/1.1"))
        assertTrue(server.request.get().contains("Authorization: Bearer session-for-device-1"))
        assertEquals(1, rows.size)
        assertEquals(4294967295L, rows.single().revision)
        assertEquals(1, server.requests.size)

        val scope = GeofenceStorageScope("family-1", "device-1")
        val state = InMemoryPersistentStateStore()
        val inbox = PersistentSafeZoneDeliveryInbox(state) { scope }
        inbox.mergeFetched(rows)
        assertEquals(rows, inbox.read())
        assertTrue(state.getString("opaque_safe_zone_delivery_v1:${scope.keyPart()}") != null)
    }

    @Test fun `malformed or extended delivery rows are rejected before persistence`() = runBlocking {
        val invalidBodies = listOf(
            """{"safeZones":[{"zoneId":"zone-1","ciphertextB64":"AQI=","nonceB64":"${"A".repeat(16)}","keyEpoch":1,"revision":1,"deliveryState":"READY","updatedAtUtc":"2026-10-10T10:20:30.000Z"}],"nextCursor":null}""",
            """{"safeZones":[{"zoneId":"zone-1","ciphertextB64":"AQID","nonceB64":"${"A".repeat(16)}","keyEpoch":2147483648,"revision":1,"deliveryState":"READY","updatedAtUtc":"2026-10-10T10:20:30.000Z"}],"nextCursor":null}""",
            """{"safeZones":[{"zoneId":"zone-1","ciphertextB64":"AQID","nonceB64":"${"A".repeat(16)}","keyEpoch":1,"revision":1,"deliveryState":"READY","updatedAtUtc":"2026-10-10T10:20:30.000Z","familyId":"attacker-family"}],"nextCursor":null}""",
            page(listOf(row("zone-1")), "invalid.cursor"),
            page(listOf(row("zone-1"), row("zone-1")), null),
        )
        for (body in invalidBodies) {
            val server = LocalServer(200, body)
            val session = sessions()
            session.authenticate()
            assertTrue(runCatching { HttpSafeZoneDeliveryClient(server.url, session, allowInsecureLocal = true).fetch() }.isFailure)
        }
    }

    @Test fun `malformed JSON response is typed retryable while authenticated scope injection stays blocked`() = runBlocking {
        val session = sessions().also { it.authenticate() }
        val malformed = LocalServer(200, "{")
        val parseFailure = runCatching {
            HttpSafeZoneDeliveryClient(malformed.url, session, allowInsecureLocal = true).fetch()
        }.exceptionOrNull()
        assertTrue(parseFailure is SafeZoneDeliveryMalformedResponseException)

        val scopeInjection = LocalServer(200, page(listOf(row("zone-1").replace("}", ",\"familyId\":\"attacker\"}")), null))
        val authorityFailure = runCatching {
            HttpSafeZoneDeliveryClient(scopeInjection.url, session, allowInsecureLocal = true).fetch()
        }.exceptionOrNull()
        assertTrue(authorityFailure is SafeZoneDeliveryAuthorityFailure)
    }

    @Test fun `malformed UTF-8 response is rejected before Safe Zone page or cursor staging`() = runBlocking {
        val scope = GeofenceStorageScope("family-1", "device-1")
        val inbox = PersistentSafeZoneDeliveryInbox(InMemoryPersistentStateStore()) { scope }
        val malformed = byteArrayOf(0xC3.toByte(), 0x28)
        val prefix = """{"safeZones":[{"zoneId":"zone-1","ciphertextB64":"AQID","nonceB64":"${"A".repeat(16)}","keyEpoch":1,"revision":1,"deliveryState":"READY","updatedAtUtc":"2026-10-10T10:20:30.""".toByteArray()
        val suffix = """Z"} ],"nextCursor":null}""".toByteArray()
        val server = RawByteServer(200, prefix + malformed + suffix)
        val session = sessions().also { it.authenticate() }

        val failure = runCatching {
            HttpSafeZoneDeliveryClient(server.url, session, allowInsecureLocal = true).synchronize(inbox)
        }.exceptionOrNull()

        assertTrue(failure is SafeZoneDeliveryMalformedResponseException)
        assertTrue(failure?.cause is java.nio.charset.CharacterCodingException)
        assertTrue(server.finished.await(2, TimeUnit.SECONDS))
        assertTrue(inbox.read().isEmpty())
        assertNull(inbox.nextCursor())
    }

    @Test fun `fractional revision is typed malformed and never advances the durable cursor`() = runBlocking {
        val scope = GeofenceStorageScope("family-1", "device-1")
        val inbox = PersistentSafeZoneDeliveryInbox(InMemoryPersistentStateStore()) { scope }
        val malformedPage = page(listOf(row("zone-01").replace("\"revision\":1", "\"revision\":1.5")), null)
        val server = LocalServer(200, malformedPage)
        val session = sessions().also { it.authenticate() }

        val failure = runCatching {
            HttpSafeZoneDeliveryClient(server.url, session, allowInsecureLocal = true).synchronize(inbox)
        }.exceptionOrNull()

        assertTrue(failure is SafeZoneDeliveryMalformedResponseException)
        assertTrue(server.finished.await(2, TimeUnit.SECONDS))
        assertTrue(inbox.read().isEmpty())
        assertNull(inbox.nextCursor())
    }

    @Test fun `walks every ordered page under one authenticated session`() = runBlocking {
        val firstRows = (0 until 16).map { row("zone-%02d".format(it)) }
        val secondRows = listOf(row("zone-16"))
        val server = LocalServer(200 to page(firstRows, "zone-15"), 200 to page(secondRows, null))
        val session = sessions()
        session.authenticate()
        val records = HttpSafeZoneDeliveryClient(server.url, session, allowInsecureLocal = true).fetch()
        assertEquals(17, records.size)
        assertEquals("zone-00", records.first().zoneId)
        assertEquals("zone-16", records.last().zoneId)
        assertTrue(server.finished.await(2, TimeUnit.SECONDS))
        assertEquals(2, server.requests.size)
        assertTrue(server.requests[0].startsWith("GET /v1/runtime-sync/safe-zones HTTP/1.1"))
        assertTrue(server.requests[1].startsWith("GET /v1/runtime-sync/safe-zones?cursor=zone-15 HTTP/1.1"))
        assertTrue(server.requests.all { it.contains("Authorization: Bearer session-for-device-1") })
    }

    @Test fun `versioned cursor epoch and last zone bind each returned page`() = runBlocking {
        val rows = (0 until 16).map { row("zone-%02d".format(it), keyEpoch = 3) }
        val session = sessions().also { it.authenticate() }
        val valid = LocalServer(200 to page(rows, "v1~3~zone-15"), 200 to page(listOf(row("zone-16", keyEpoch = 3)), null))
        assertEquals(17, HttpSafeZoneDeliveryClient(valid.url, session, allowInsecureLocal = true).fetch().size)
        assertTrue(valid.finished.await(2, TimeUnit.SECONDS))
        assertTrue(valid.requests[1].startsWith("GET /v1/runtime-sync/safe-zones?cursor=v1~3~zone-15 HTTP/1.1"))

        val invalidCursors = listOf("v1~4~zone-15", "v1~3~zone-14", "v1~0~zone-15", "v1~2147483648~zone-15")
        for (cursor in invalidCursors) {
            val malformed = LocalServer(200, page(rows, cursor))
            val freshSession = sessions().also { it.authenticate() }
            val failure = runCatching {
                HttpSafeZoneDeliveryClient(malformed.url, freshSession, allowInsecureLocal = true).fetch()
            }.exceptionOrNull()
            assertTrue("cursor $cursor must be rejected", failure is SafeZoneDeliveryMalformedResponseException)
        }
    }

    @Test fun `legacy and stale epoch cursors accept a restarted first page and resume on the new epoch`() = runBlocking {
        for (requestedCursor in listOf("zone-15", "v1~1~zone-15")) {
            val scope = GeofenceStorageScope("family-1", "device-1")
            val backing = InMemoryPersistentStateStore()
            val inbox = PersistentSafeZoneDeliveryInbox(backing) { scope }
            val previousPage = (0 until 16).map {
                delivery("AQID", 1).copy(zoneId = "zone-%02d".format(it), keyEpoch = 1)
            }
            inbox.stagePage(scope, previousPage, requestedCursor = null, nextCursor = requestedCursor)

            // The backend restarts at page one for a legacy raw cursor or stale epoch cursor.
            // These rows intentionally include IDs earlier than the requested zone-15 cursor.
            val restartedPage = (0 until 16).map { row("zone-%02d".format(it), revision = 2, keyEpoch = 2) }
            val currentCursor = "v1~2~zone-15"
            val interruptedServer = LocalServer(200 to page(restartedPage, currentCursor), 503 to "{}")
            val session = sessions().also { it.authenticate() }
            val interruption = runCatching {
                HttpSafeZoneDeliveryClient(interruptedServer.url, session, allowInsecureLocal = true).synchronize(inbox)
            }.exceptionOrNull()

            assertTrue(interruption is SafeZoneDeliveryHttpFailure)
            assertTrue(interruptedServer.finished.await(2, TimeUnit.SECONDS))
            assertTrue(interruptedServer.requests[0].startsWith(
                "GET /v1/runtime-sync/safe-zones?cursor=$requestedCursor HTTP/1.1"))
            assertEquals(currentCursor, inbox.nextCursor())
            assertTrue(inbox.read().all { it.keyEpoch == 2 && it.revision == 2L })

            val resumedServer = LocalServer(200, page(listOf(row("zone-16", revision = 2, keyEpoch = 2)), null))
            HttpSafeZoneDeliveryClient(resumedServer.url, session, allowInsecureLocal = true).synchronize(inbox)
            assertTrue(resumedServer.finished.await(2, TimeUnit.SECONDS))
            assertTrue(resumedServer.request.get().startsWith(
                "GET /v1/runtime-sync/safe-zones?cursor=$currentCursor HTTP/1.1"))
            assertEquals((0..16).map { "zone-%02d".format(it) }, inbox.read().map { it.zoneId })
            assertNull(inbox.nextCursor())
        }
    }

    @Test fun `persisted versioned cursor must match a stored epoch and zone`() {
        val scope = GeofenceStorageScope("family-1", "device-1")
        val backing = InMemoryPersistentStateStore()
        val inbox = PersistentSafeZoneDeliveryInbox(backing) { scope }
        val rows = (0 until 16).map { delivery("AQID", 1).copy(zoneId = "zone-%02d".format(it), keyEpoch = 3) }
        inbox.stagePage(scope, rows, requestedCursor = null, nextCursor = "v1~3~zone-15")
        assertEquals("v1~3~zone-15", inbox.nextCursor())

        val storageKey = "opaque_safe_zone_delivery_v1:${scope.keyPart()}"
        val persisted = org.json.JSONObject(requireNotNull(backing.getString(storageKey)))
        persisted.put("nextCursor", "v1~4~zone-15")
        backing.putString(storageKey, persisted.toString())
        val reopened = PersistentSafeZoneDeliveryInbox(backing) { scope }
        val failure = runCatching { reopened.read() }.exceptionOrNull()
        assertTrue(failure is SafeZoneDeliveryInboxCorruptException)
    }

    @Test fun `later page failure leaves the durable inbox unchanged`() = runBlocking {
        val scope = GeofenceStorageScope("family-1", "device-1")
        val state = InMemoryPersistentStateStore()
        val inbox = PersistentSafeZoneDeliveryInbox(state) { scope }
        val retained = delivery(ciphertext = "AQID", revision = 4)
        inbox.mergeFetched(listOf(retained))
        val firstRows = (0 until 16).map { row("zone-%02d".format(it)) }
        val server = LocalServer(200 to page(firstRows, "zone-15"), 503 to "{}")
        val session = sessions()
        session.authenticate()
        assertTrue(runCatching {
            val complete = HttpSafeZoneDeliveryClient(server.url, session, allowInsecureLocal = true).fetch()
            inbox.mergeFetched(complete)
        }.isFailure)
        assertEquals(listOf(retained), inbox.read())
        assertTrue(server.finished.await(2, TimeUnit.SECONDS))
        assertEquals(2, server.requests.size)
    }

    @Test fun `stages each page and resumes from the durable cursor after relaunch`() = runBlocking {
        val scope = GeofenceStorageScope("family-1", "device-1")
        val state = InMemoryPersistentStateStore()
        val inbox = PersistentSafeZoneDeliveryInbox(state) { scope }
        val firstRows = (0 until 16).map { row("zone-%02d".format(it)) }
        val interruptedServer = LocalServer(
            200 to page(firstRows, "zone-15"),
            503 to "{}",
        )
        val session = sessions().also { it.authenticate() }
        val interrupted = runCatching {
            HttpSafeZoneDeliveryClient(interruptedServer.url, session, allowInsecureLocal = true).synchronize(inbox)
        }.exceptionOrNull()

        assertTrue(interrupted is SafeZoneDeliveryHttpFailure)
        assertEquals(503, (interrupted as SafeZoneDeliveryHttpFailure).statusCode)
        assertEquals((0..15).map { "zone-%02d".format(it) }, inbox.read().map { it.zoneId })
        assertEquals("zone-15", inbox.nextCursor())
        assertTrue(interruptedServer.finished.await(2, TimeUnit.SECONDS))
        assertEquals(2, interruptedServer.requests.size)

        val resumedServer = LocalServer(200, page(listOf(row("zone-16")), null))
        HttpSafeZoneDeliveryClient(resumedServer.url, session, allowInsecureLocal = true).synchronize(inbox)
        assertTrue(resumedServer.finished.await(2, TimeUnit.SECONDS))
        assertEquals(1, resumedServer.requests.size)
        assertTrue(resumedServer.request.get().startsWith("GET /v1/runtime-sync/safe-zones?cursor=zone-15 HTTP/1.1"))
        assertTrue(resumedServer.request.get().contains("Authorization: Bearer session-for-device-1"))
        assertEquals((0..16).map { "zone-%02d".format(it) }, inbox.read().map { it.zoneId })
        assertNull(inbox.nextCursor())
    }

    @Test fun `legacy inbox data resumes from the first page cursor`() {
        val scope = GeofenceStorageScope("family-1", "device-1")
        val backing = InMemoryPersistentStateStore()
        backing.putString(
            "opaque_safe_zone_delivery_v1:${scope.keyPart()}",
            """{"version":1,"records":[${row("zone-01")}] }""",
        )
        val inbox = PersistentSafeZoneDeliveryInbox(backing) { scope }

        assertEquals(listOf("zone-01"), inbox.read().map { it.zoneId })
        assertNull(inbox.nextCursor())
    }

    @Test fun `scope change after page response prevents staging into the new enrollment`() = runBlocking {
        val firstScope = GeofenceStorageScope("family-1", "device-1")
        val secondScope = GeofenceStorageScope("family-2", "device-1")
        var scopeReads = 0
        val state = InMemoryPersistentStateStore()
        val inbox = PersistentSafeZoneDeliveryInbox(state) {
            scopeReads++
            if (scopeReads <= 2) firstScope else secondScope
        }
        val server = LocalServer(200, page(listOf(row("zone-01")), null))
        val session = sessions().also { it.authenticate() }
        val failure = runCatching {
            HttpSafeZoneDeliveryClient(server.url, session, allowInsecureLocal = true).synchronize(inbox)
        }.exceptionOrNull()

        assertTrue(failure is SafeZoneDeliveryAuthorityFailure)
        assertTrue(PersistentSafeZoneDeliveryInbox(state) { firstScope }.read().isEmpty())
        assertTrue(PersistentSafeZoneDeliveryInbox(state) { secondScope }.read().isEmpty())
    }

    @Test fun `scope device mismatch is rejected before network access`() = runBlocking {
        val wrongScope = GeofenceStorageScope("family-1", "different-device")
        val inbox = PersistentSafeZoneDeliveryInbox(InMemoryPersistentStateStore()) { wrongScope }
        val server = LocalServer(200, page(listOf(row("zone-01")), null))
        val session = sessions().also { it.authenticate() }

        val failure = runCatching {
            HttpSafeZoneDeliveryClient(server.url, session, allowInsecureLocal = true).synchronize(inbox)
        }.exceptionOrNull()

        assertTrue(failure is SafeZoneDeliveryAuthorityFailure)
        assertTrue(server.requests.isEmpty())
        assertTrue(inbox.read().isEmpty())
        server.close()
        assertTrue(server.finished.await(2, TimeUnit.SECONDS))
    }

    @Test fun `bounded page limit fails without returning or staging partial records`() = runBlocking {
        val responses = (0 until 8).map { pageIndex ->
            val ids = (pageIndex * 16 until (pageIndex + 1) * 16).map { "zone-%03d".format(it) }
            200 to page(ids.map(::row), ids.last())
        }.toTypedArray()
        val server = LocalServer(*responses)
        val session = sessions()
        session.authenticate()
        assertTrue(runCatching { HttpSafeZoneDeliveryClient(server.url, session, allowInsecureLocal = true).fetch() }.isFailure)
        assertTrue(server.finished.await(2, TimeUnit.SECONDS))
        assertEquals(8, server.requests.size)
    }

    @Test fun `delivery over 128 rows stages and resumes across bounded invocations`() = runBlocking {
        val scope = GeofenceStorageScope("family-1", "device-1")
        val backing = InMemoryPersistentStateStore()
        val inbox = PersistentSafeZoneDeliveryInbox(backing) { scope }
        val responses = (0 until 8).map { pageIndex ->
            val ids = (pageIndex * 16 until (pageIndex + 1) * 16).map { "zone-%03d".format(it) }
            200 to page(ids.map(::row), ids.last())
        }.toTypedArray()
        val session = sessions().also { it.authenticate() }
        val firstBatch = LocalServer(*responses)
        val bounded = runCatching {
            HttpSafeZoneDeliveryClient(firstBatch.url, session, allowInsecureLocal = true).synchronize(inbox)
        }.exceptionOrNull()

        assertTrue(bounded is SafeZoneDeliveryIncompleteException)
        assertEquals(128, inbox.read().size)
        assertEquals("zone-127", inbox.nextCursor())

        val nextPage = LocalServer(200, page(listOf(row("zone-128")), null))
        val relaunchedInbox = PersistentSafeZoneDeliveryInbox(backing) { scope }
        HttpSafeZoneDeliveryClient(nextPage.url, session, allowInsecureLocal = true).synchronize(relaunchedInbox)
        assertTrue(nextPage.finished.await(2, TimeUnit.SECONDS))
        assertEquals(129, relaunchedInbox.read().size)
        assertEquals("zone-128", relaunchedInbox.read().last().zoneId)
        assertNull(relaunchedInbox.nextCursor())
    }

    @Test fun `staged size bound failure does not advance cursor`() {
        val scope = GeofenceStorageScope("family-1", "device-1")
        val state = InMemoryPersistentStateStore()
        val inbox = PersistentSafeZoneDeliveryInbox(state) { scope }
        val largeCiphertext = java.util.Base64.getUrlEncoder().withoutPadding()
            .encodeToString(ByteArray(65_535))

        var cursor: String? = null
        for (pageIndex in 0 until 11) {
            val records = (pageIndex * 16 until (pageIndex + 1) * 16).map { index ->
                delivery(ciphertext = largeCiphertext, revision = 1).copy(zoneId = "zone-%03d".format(index))
            }
            val next = records.last().zoneId
            inbox.stagePage(scope, records, requestedCursor = cursor, nextCursor = next)
            cursor = next
        }
        assertEquals("zone-175", cursor)
        val storageKey = "opaque_safe_zone_delivery_v1:${scope.keyPart()}"
        val before = state.getString(storageKey)
        val finalRecords = (176 until 192).map { index ->
            delivery(ciphertext = largeCiphertext, revision = 1).copy(zoneId = "zone-%03d".format(index))
        }
        val failure = runCatching {
            inbox.stagePage(scope, finalRecords, requestedCursor = cursor, nextCursor = "zone-191")
        }.exceptionOrNull()

        assertTrue(failure is SafeZoneDeliveryIncompleteException)
        assertEquals("zone-175", inbox.nextCursor())
        assertEquals(before, state.getString(storageKey))
    }

    @Test fun `unauthorized delivery invalidates only its rejected device session`() = runBlocking {
        val delegate = FakeRelayHttpClient()
        val relay = object : RelayHttpClient by delegate {
            var challenges = 0
            override suspend fun issueChallenge(deviceId: String) = delegate.issueChallenge(deviceId).also { challenges++ }
        }
        val session = sessions(relay)
        session.authenticate()
        assertEquals(1, relay.challenges)
        val server = LocalServer(401, """{"error":"unauthorized"}""")
        val failure = runCatching {
            HttpSafeZoneDeliveryClient(server.url, session, allowInsecureLocal = true).fetch()
        }.exceptionOrNull()
        assertTrue(failure is SafeZoneDeliveryHttpFailure)
        assertEquals(401, (failure as SafeZoneDeliveryHttpFailure).statusCode)
        assertFalse(session.isAuthenticated())
        assertEquals("session-for-device-1", session.requireSessionToken())
        assertEquals(2, relay.challenges)
    }

    @Test fun `request timeout status is preserved for graph retry classification`() = runBlocking {
        val session = sessions().also { it.authenticate() }
        val server = LocalServer(408, "{}")
        val failure = runCatching {
            HttpSafeZoneDeliveryClient(server.url, session, allowInsecureLocal = true).fetch()
        }.exceptionOrNull()
        assertTrue(failure is SafeZoneDeliveryHttpFailure)
        assertEquals(408, (failure as SafeZoneDeliveryHttpFailure).statusCode)
    }

    @Test fun `cancelling blocked page fetch disconnects transport without staging the page`() = runBlocking {
        val socket = ServerSocket(0)
        val requestReceived = CountDownLatch(1)
        val clientDisconnected = CountDownLatch(1)
        val serverThread = Thread {
            try {
                socket.accept().use { client ->
                    client.soTimeout = 5000
                    val input = client.getInputStream().bufferedReader(StandardCharsets.US_ASCII)
                    while (true) {
                        val line = input.readLine() ?: break
                        if (line.isEmpty()) break
                    }
                    requestReceived.countDown()
                    // Keep the response blocked. The client must close its socket when its
                    // coroutine is cancelled rather than waiting for the 15-second read timeout.
                    if (input.read() < 0) clientDisconnected.countDown()
                }
            } catch (_: SocketException) {
                clientDisconnected.countDown()
            } catch (_: IOException) {
                clientDisconnected.countDown()
            } finally {
                socket.close()
            }
        }.apply { isDaemon = true; start() }

        val scope = GeofenceStorageScope("family-1", "device-1")
        val inbox = PersistentSafeZoneDeliveryInbox(InMemoryPersistentStateStore()) { scope }
        val session = sessions().also { it.authenticate() }
        val client = HttpSafeZoneDeliveryClient("http://127.0.0.1:${socket.localPort}", session, allowInsecureLocal = true)
        val sync = launch(Dispatchers.Default) { client.synchronize(inbox) }

        try {
            // The test runner may be busy compiling/running other suites; allow
            // scheduling headroom while still failing before the client's
            // 15-second network timeout if no request is ever made.
            assertTrue("request reached server", requestReceived.await(10, TimeUnit.SECONDS))
            sync.cancelAndJoin()

            assertTrue("cancel closes blocked HTTP connection", clientDisconnected.await(3, TimeUnit.SECONDS))
            assertTrue(inbox.read().isEmpty())
            assertNull(inbox.nextCursor())
        } finally {
            sync.cancelAndJoin()
            socket.close()
            serverThread.join(1000)
        }
    }

    @Test fun `staging never rolls back revisions or accepts same revision conflicts`() {
        val scope = GeofenceStorageScope("family-1", "device-1")
        val inbox = PersistentSafeZoneDeliveryInbox(InMemoryPersistentStateStore()) { scope }
        val first = delivery(ciphertext = "AQID", revision = 4)
        inbox.mergeFetched(listOf(first))
        inbox.mergeFetched(listOf(delivery(ciphertext = "BAUG", revision = 3)))
        assertEquals(first, inbox.read().single())
        val conflict = runCatching { inbox.mergeFetched(listOf(delivery(ciphertext = "BAUG", revision = 4))) }.exceptionOrNull()
        assertTrue(conflict is SafeZoneDeliveryRevisionConflictException)
        assertEquals(first, inbox.read().single())
    }

    @Test fun `persistence boundary rejects malformed opaque rows without writing`() {
        val scope = GeofenceStorageScope("family-1", "device-1")
        val backing = InMemoryPersistentStateStore()
        val inbox = PersistentSafeZoneDeliveryInbox(backing) { scope }
        val failure = runCatching {
            inbox.mergeFetched(listOf(delivery(ciphertext = "AQI=", revision = 1)))
        }.exceptionOrNull()

        assertTrue(failure is IllegalArgumentException)
        assertTrue(inbox.read().isEmpty())
        assertNull(backing.getString("opaque_safe_zone_delivery_v1:${scope.keyPart()}"))
    }

    @Test fun `corrupt persisted opaque bytes fail closed when inbox is reopened`() {
        val scope = GeofenceStorageScope("family-1", "device-1")
        val backing = InMemoryPersistentStateStore()
        val inbox = PersistentSafeZoneDeliveryInbox(backing) { scope }
        inbox.mergeFetched(listOf(delivery(ciphertext = "AQID", revision = 1)))
        val storageKey = "opaque_safe_zone_delivery_v1:${scope.keyPart()}"
        val raw = requireNotNull(backing.getString(storageKey))
        backing.putString(storageKey, raw.replace("\"ciphertextB64\":\"AQID\"", "\"ciphertextB64\":\"AQI=\""))

        val failure = runCatching { PersistentSafeZoneDeliveryInbox(backing) { scope }.read() }.exceptionOrNull()
        assertTrue(failure is SafeZoneDeliveryInboxCorruptException)
    }

    @Test fun `staging I O failure is surfaced as a retryable persistence failure`() {
        val backing = InMemoryPersistentStateStore()
        val failingState = object : PersistentStateStore by backing {
            override fun flush() { throw IOException("storage temporarily unavailable") }
        }
        val inbox = PersistentSafeZoneDeliveryInbox(failingState) { GeofenceStorageScope("family-1", "device-1") }
        val failure = runCatching { inbox.mergeFetched(listOf(delivery(ciphertext = "AQID", revision = 1))) }.exceptionOrNull()
        assertTrue(failure is SafeZoneDeliveryPersistenceIoException)
    }

    @Test fun `failed page flush restores prior rows and cursor for same process retry`() {
        val scope = GeofenceStorageScope("family-1", "device-1")
        val backing = InMemoryPersistentStateStore()
        var flushCount = 0
        val failOnceState = object : PersistentStateStore by backing {
            override fun flush() {
                flushCount++
                if (flushCount == 2) throw IOException("commit failed after in-memory apply")
                backing.flush()
            }
        }
        val inbox = PersistentSafeZoneDeliveryInbox(failOnceState) { scope }
        val firstPage = (0 until 16).map { index ->
            delivery(ciphertext = "AQID", revision = 1).copy(zoneId = "zone-%03d".format(index))
        }
        inbox.stagePage(scope, firstPage, requestedCursor = null, nextCursor = "zone-015")
        val priorRaw = backing.getString("opaque_safe_zone_delivery_v1:${scope.keyPart()}")
        val secondPage = (16 until 32).map { index ->
            delivery(ciphertext = "AQID", revision = 1).copy(zoneId = "zone-%03d".format(index))
        }

        val failure = runCatching {
            inbox.stagePage(scope, secondPage, requestedCursor = "zone-015", nextCursor = "zone-031")
        }.exceptionOrNull()

        assertTrue(failure is SafeZoneDeliveryPersistenceIoException)
        assertEquals(firstPage, inbox.read())
        assertEquals("zone-015", inbox.nextCursor())
        assertEquals(priorRaw, backing.getString("opaque_safe_zone_delivery_v1:${scope.keyPart()}"))

        inbox.stagePage(scope, secondPage, requestedCursor = "zone-015", nextCursor = "zone-031")
        assertEquals(firstPage + secondPage, inbox.read())
        assertEquals("zone-031", inbox.nextCursor())
    }

    private fun delivery(ciphertext: String, revision: Long) = OpaqueSafeZoneDelivery(
        zoneId = "zone-1", ciphertextB64 = ciphertext, nonceB64 = "A".repeat(16), keyEpoch = 1,
        revision = revision, deliveryState = SafeZoneDeliveryState.READY, updatedAtUtc = "2026-10-10T10:20:30.000Z",
    )

    private fun row(zoneId: String, revision: Long = 1L, keyEpoch: Int = 1): String =
        """{"zoneId":"$zoneId","ciphertextB64":"AQID","nonceB64":"${"A".repeat(16)}","keyEpoch":$keyEpoch,"revision":$revision,"deliveryState":"READY","updatedAtUtc":"2026-10-10T10:20:30.000Z"}"""

    private fun page(rows: List<String>, nextCursor: String?): String =
        """{"safeZones":[${rows.joinToString(",")}],"nextCursor":${nextCursor?.let { "\"$it\"" } ?: "null"}}"""

    private class LocalServer(vararg responses: Pair<Int, String>) {
        private val socket = ServerSocket(0)
        val url = "http://127.0.0.1:${socket.localPort}"
        val requests = java.util.concurrent.CopyOnWriteArrayList<String>()
        val request = java.util.concurrent.atomic.AtomicReference("")
        val finished = CountDownLatch(1)

        fun close() = socket.close()

        constructor(status: Int, body: String) : this(status to body)

        init {
            Thread {
                try {
                    socket.soTimeout = 5000
                    for ((status, body) in responses) {
                        socket.accept().use { client ->
                            val input = client.getInputStream().bufferedReader(StandardCharsets.US_ASCII)
                            val lines = mutableListOf<String>()
                            while (true) {
                                val line = input.readLine() ?: break
                                if (line.isEmpty()) break
                                lines += line
                            }
                            val requestText = lines.joinToString("\n")
                            requests += requestText
                            if (requests.size == 1) request.set(requestText)
                            val bytes = body.toByteArray(Charsets.UTF_8)
                            val reason = when (status) { 200 -> "OK"; 401 -> "Unauthorized"; else -> "Service Unavailable" }
                            val header = "HTTP/1.1 $status $reason\r\nContent-Type: application/json\r\nContent-Length: ${bytes.size}\r\nConnection: close\r\n\r\n"
                            client.getOutputStream().apply { write(header.toByteArray(StandardCharsets.US_ASCII)); write(bytes); flush() }
                        }
                    }
                } catch (_: java.net.SocketException) {
                    // Test teardown can close a server that intentionally received no request.
                } finally {
                    finished.countDown()
                    socket.close()
                }
            }.apply { isDaemon = true; start() }
        }
    }

    private class RawByteServer(private val status: Int, private val body: ByteArray) {
        private val socket = ServerSocket(0)
        val url = "http://127.0.0.1:${socket.localPort}"
        val finished = CountDownLatch(1)

        init {
            Thread {
                try {
                    socket.soTimeout = 5000
                    socket.accept().use { client ->
                        val input = client.getInputStream().bufferedReader(StandardCharsets.US_ASCII)
                        while (true) {
                            val line = input.readLine() ?: break
                            if (line.isEmpty()) break
                        }
                        val reason = if (status == 200) "OK" else "Service Unavailable"
                        val header = "HTTP/1.1 $status $reason\r\nContent-Type: application/json\r\nContent-Length: ${body.size}\r\nConnection: close\r\n\r\n"
                        client.getOutputStream().apply {
                            write(header.toByteArray(StandardCharsets.US_ASCII))
                            write(body)
                            flush()
                        }
                    }
                } catch (_: SocketException) {
                    // Test teardown can close a server that intentionally received no request.
                } finally {
                    finished.countDown()
                    socket.close()
                }
            }.apply { isDaemon = true; start() }
        }
    }
}
