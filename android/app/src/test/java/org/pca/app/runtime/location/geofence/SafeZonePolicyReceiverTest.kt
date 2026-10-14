package org.pca.app.runtime.location.geofence

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import org.pca.app.foundation.InMemoryPersistentStateStore
import org.pca.app.foundation.PersistentStateStore
import org.pca.app.platform.LocationSample
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.AtomicReference

class SafeZonePolicyReceiverTest {

    private val familyScope = GeofenceStorageScope("family-a", "child-a")
    private var activeScope: GeofenceStorageScope? = familyScope
    private val scopeProvider = { activeScope }
    private val backing = InMemoryPersistentStateStore()
    private val zoneStore = GeofenceZoneStore(backing, scopeProvider = scopeProvider)
    private val zoneStateStore = GeofenceZoneStateStore(backing, scopeProvider = scopeProvider)
    private val nonceBytes = ByteArray(12) { (it + 4).toByte() }

    private val zone = GeofenceZone(
        zoneId = "zone-home",
        label = "Home",
        centerLatitude = 25.0,
        centerLongitude = 55.0,
        radiusMeters = 100.0,
        enabled = true,
        transitionTypes = setOf(GeofenceTransitionType.ENTRY),
    )

    @Test
    fun `sender rotation and recipient revocation during decrypt never persist policy`() = runTest {
        for (changeRecipient in listOf(true, false)) {
            var recipientAllowed = true
            var signingKey = "parent-public-key"
            val mutableAuthority = object : SafeZoneFamilyAuthority {
                override suspend fun isRecipientAuthorized(familyId: String, recipientEndpointId: String, trustSetEpoch: Long, keyEpoch: Long) = recipientAllowed
                override suspend fun resolveAuthorizedSender(familyId: String, senderDeviceId: String, senderKeyId: String, trustSetEpoch: Long, keyEpoch: Long) =
                    SafeZoneAuthorizedSender(SafeZoneFamilyRole.OWNER, signingKey)
            }
            val entered = CompletableDeferred<Unit>()
            val release = CompletableDeferred<Unit>()
            val plaintext = SafeZonePolicyPayloadCodec.encode(SafeZonePolicyPayload("family-a", "child-a", "zone-home", 1L, 3L, zone))
            val receiver = SafeZonePolicyReceiver("family-a", "child-a", mutableAuthority, approvingVerifier,
                object : SafeZonePayloadDecryptor {
                    override suspend fun decrypt(envelope: SafeZonePolicyEnvelope, senderPublicSigningKey: String): ByteArray {
                        entered.complete(Unit); release.await(); return plaintext
                    }
                }, zoneStore, zoneStateStore)
            val receiving = async { receiver.receive(envelope(), 2_000L) }
            entered.await()
            if (changeRecipient) recipientAllowed = false else signingKey = "rotated-key"
            release.complete(Unit)
            assertEquals(SafeZonePolicyReceiveResult.REJECTED, receiving.await())
            assertTrue(zoneStore.loadZones().isEmpty())
            val reopened = GeofenceZoneStore(backing, scopeProvider = scopeProvider)
            assertTrue(reopened.loadZones().isEmpty())
            assertTrue(plaintext.all { it == 0.toByte() })
        }
    }

    @Test
    fun `cancelled suspended verifier propagates cancellation without persisted effects`() = runTest {
        val entered = CompletableDeferred<Unit>()
        val verifier = object : SafeZoneEnvelopeSignatureVerifier {
            override suspend fun verify(envelope: SafeZonePolicyEnvelope, senderPublicSigningKey: String): Boolean {
                entered.complete(Unit); CompletableDeferred<Unit>().await(); return true
            }
        }
        val receiver = SafeZonePolicyReceiver("family-a", "child-a", authority(), verifier,
            RejectingSafeZonePayloadDecryptor(), zoneStore, zoneStateStore)
        var propagated = false
        val receiving = launch {
            try { receiver.receive(envelope(), 2_000L) }
            catch (cancelled: CancellationException) { propagated = true; throw cancelled }
        }
        entered.await(); receiving.cancel(); receiving.join()
        assertTrue(propagated)
        assertTrue(zoneStore.loadZones().isEmpty())
    }

    @Test
    fun `caller mutation while verifier suspended cannot alter decrypted envelope`() = runTest {
        val original = envelope()
        val entered = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        val verifier = object : SafeZoneEnvelopeSignatureVerifier {
            override suspend fun verify(envelope: SafeZonePolicyEnvelope, senderPublicSigningKey: String): Boolean {
                entered.complete(Unit); release.await()
                return envelope.ciphertext.contentEquals(byteArrayOf(1, 2, 3)) && envelope.nonce.contentEquals(nonceBytes)
            }
        }
        val receiver = SafeZonePolicyReceiver("family-a", "child-a", authority(), verifier,
            object : SafeZonePayloadDecryptor {
                override suspend fun decrypt(envelope: SafeZonePolicyEnvelope, senderPublicSigningKey: String): ByteArray {
                    assertTrue(envelope.ciphertext.contentEquals(byteArrayOf(1, 2, 3)))
                    return envelope.payloadForTest()
                }
            }, zoneStore, zoneStateStore)
        val receiving = async { receiver.receive(original, 2_000L) }
        entered.await(); original.ciphertext.fill(9); original.nonce.fill(9); release.complete(Unit)
        assertEquals(SafeZonePolicyReceiveResult.APPLIED, receiving.await())
        assertEquals(zone, GeofenceZoneStore(backing, scopeProvider = scopeProvider).loadZones().single())
    }

    @Test
    fun `verifier mutation cannot alter bytes passed to decryptor`() = runTest {
        val verifier = object : SafeZoneEnvelopeSignatureVerifier {
            override suspend fun verify(envelope: SafeZonePolicyEnvelope, senderPublicSigningKey: String): Boolean {
                envelope.ciphertext.fill(9)
                envelope.nonce.fill(9)
                return true
            }
        }
        val receiver = SafeZonePolicyReceiver("family-a", "child-a", authority(), verifier,
            object : SafeZonePayloadDecryptor {
                override suspend fun decrypt(envelope: SafeZonePolicyEnvelope, senderPublicSigningKey: String): ByteArray {
                    assertTrue(envelope.ciphertext.contentEquals(byteArrayOf(1, 2, 3)))
                    assertTrue(envelope.nonce.contentEquals(nonceBytes))
                    return envelope.payloadForTest()
                }
            }, zoneStore, zoneStateStore)

        assertEquals(SafeZonePolicyReceiveResult.APPLIED, receiver.receive(envelope(), 2_000L))
        assertEquals(zone, GeofenceZoneStore(backing, scopeProvider = scopeProvider).loadZones().single())
    }

    @Test
    fun `expiry crossed during suspended crypto rejects before persistence and wipes plaintext`() = runTest {
        for (suspendVerification in listOf(true, false)) {
            var clockNanos = 0L
            val entered = CompletableDeferred<Unit>()
            val release = CompletableDeferred<Unit>()
            val plaintext = SafeZonePolicyPayloadCodec.encode(SafeZonePolicyPayload("family-a", "child-a", "zone-home", 1L, 3L, zone))
            val receiver = SafeZonePolicyReceiver("family-a", "child-a", authority(),
                object : SafeZoneEnvelopeSignatureVerifier {
                    override suspend fun verify(envelope: SafeZonePolicyEnvelope, senderPublicSigningKey: String): Boolean {
                        if (suspendVerification) { entered.complete(Unit); release.await() }
                        return true
                    }
                },
                object : SafeZonePayloadDecryptor {
                    override suspend fun decrypt(envelope: SafeZonePolicyEnvelope, senderPublicSigningKey: String): ByteArray {
                        if (!suspendVerification) { entered.complete(Unit); release.await() }
                        return plaintext
                    }
                }, zoneStore, zoneStateStore, monotonicNanos = { clockNanos })
            val receiving = async { receiver.receive(envelope(), 2_000L) }
            entered.await(); clockNanos = 8_000_000_000L; release.complete(Unit)
            assertEquals(SafeZonePolicyReceiveResult.REJECTED, receiving.await())
            assertTrue(plaintext.all { it == 0.toByte() })
            assertTrue(GeofenceZoneStore(backing, scopeProvider = scopeProvider).loadZones().isEmpty())
        }
    }

    @Test
    fun `expiry crossed while waiting for monitor policy lock rejects before persistence`() {
        val clockNanos = AtomicLong(0L)
        val decrypted = CountDownLatch(1)
        val receiver = SafeZonePolicyReceiver("family-a", "child-a", authority(), approvingVerifier,
            object : SafeZonePayloadDecryptor {
                override suspend fun decrypt(envelope: SafeZonePolicyEnvelope, senderPublicSigningKey: String): ByteArray {
                    decrypted.countDown()
                    return envelope.payloadForTest()
                }
            }, zoneStore, zoneStateStore, monotonicNanos = clockNanos::get)
        val outcome = AtomicReference<SafeZonePolicyReceiveResult>()
        val failure = AtomicReference<Throwable>()
        val worker = Thread {
            try { outcome.set(runBlocking { receiver.receive(envelope(), 2_000L) }) }
            catch (error: Throwable) { failure.set(error) }
        }
        synchronized(backing.coordinationLock) {
            worker.start()
            assertTrue(decrypted.await(5, TimeUnit.SECONDS))
            val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5)
            while (worker.state != Thread.State.BLOCKED && System.nanoTime() < deadline) Thread.yield()
            assertEquals(Thread.State.BLOCKED, worker.state)
            clockNanos.set(8_000_000_000L)
        }
        worker.join(5_000)
        assertTrue(!worker.isAlive)
        assertNull(failure.get())
        assertEquals(SafeZonePolicyReceiveResult.REJECTED, outcome.get())
        assertTrue(zoneStore.loadZones().isEmpty())
    }

    private fun envelope(
        familyId: String = "family-a",
        recipientEndpointId: String = "child-a",
        payload: ByteArray = SafeZonePolicyPayloadCodec.encode(
            SafeZonePolicyPayload(familyId, recipientEndpointId, "zone-home", 1L, 3L, zone),
        ),
    ) = SafeZonePolicyEnvelope(
        familyId = familyId,
        recipientEndpointId = recipientEndpointId,
        senderDeviceId = "parent-a",
        senderKeyId = "parent-signing-key",
        trustSetEpoch = 2L,
        keyEpoch = 3L,
        revision = 1L,
        zoneId = "zone-home",
        ciphertext = byteArrayOf(1, 2, 3),
        nonce = nonceBytes.copyOf(),
        signature = "signature",
        issuedAtEpochMillis = 1_000L,
        expiresAtEpochMillis = 10_000L,
    )

    private fun authority(role: SafeZoneFamilyRole = SafeZoneFamilyRole.OWNER) = object : SafeZoneFamilyAuthority {
        override suspend fun isRecipientAuthorized(familyId: String, recipientEndpointId: String, trustSetEpoch: Long, keyEpoch: Long): Boolean =
            familyId == "family-a" && recipientEndpointId == "child-a" && trustSetEpoch == 2L && keyEpoch == 3L

        override suspend fun resolveAuthorizedSender(
            familyId: String,
            senderDeviceId: String,
            senderKeyId: String,
            trustSetEpoch: Long,
            keyEpoch: Long,
        ): SafeZoneAuthorizedSender? =
            if (familyId == "family-a" && senderDeviceId == "parent-a" && senderKeyId == "parent-signing-key" && trustSetEpoch == 2L && keyEpoch == 3L) {
                SafeZoneAuthorizedSender(role, "parent-public-key")
            } else {
                null
            }
    }

    private val approvingVerifier = object : SafeZoneEnvelopeSignatureVerifier {
        override suspend fun verify(envelope: SafeZonePolicyEnvelope, senderPublicSigningKey: String): Boolean =
            senderPublicSigningKey == "parent-public-key" && envelope.signature == "signature"
    }

    @Test
    fun `receiver rejects opaque envelope bounds before crypto and preserves accepted policy`() = runTest {
        var verifierCalls = 0
        var decryptCalls = 0
        val receiver = SafeZonePolicyReceiver(
            localFamilyId = "family-a",
            localEndpointId = "child-a",
            authority = authority(),
            signatureVerifier = object : SafeZoneEnvelopeSignatureVerifier {
                override suspend fun verify(envelope: SafeZonePolicyEnvelope, senderPublicSigningKey: String): Boolean {
                    verifierCalls++
                    return approvingVerifier.verify(envelope, senderPublicSigningKey)
                }
            },
            decryptor = object : SafeZonePayloadDecryptor {
                override suspend fun decrypt(envelope: SafeZonePolicyEnvelope, senderPublicSigningKey: String): ByteArray {
                    decryptCalls++
                    return envelope.payloadForTest()
                }
            },
            zoneStore = zoneStore,
            zoneStateStore = zoneStateStore,
        )

        assertEquals(SafeZonePolicyReceiveResult.APPLIED, receiver.receive(envelope(), 2_000L))
        val maximumWireBounds = envelope().copy(
            revision = 2L,
            ciphertext = ByteArray(65_535),
            nonce = ByteArray(64),
        )
        assertEquals(SafeZonePolicyReceiveResult.APPLIED, receiver.receive(maximumWireBounds, 2_000L))
        val retained = zoneStore.loadZones()
        val callsBeforeInvalid = verifierCalls to decryptCalls
        val invalidEnvelopes = listOf(
            envelope().copy(ciphertext = byteArrayOf()),
            envelope().copy(ciphertext = ByteArray(65_536)),
            envelope().copy(nonce = ByteArray(11)),
            envelope().copy(nonce = ByteArray(65)),
            envelope().copy(revision = GeofenceZone.MAX_REVISION + 1L),
        )

        invalidEnvelopes.forEach { invalid ->
            assertEquals(SafeZonePolicyReceiveResult.REJECTED, receiver.receive(invalid, 2_000L))
        }

        assertEquals(callsBeforeInvalid, verifierCalls to decryptCalls)
        assertEquals(retained, zoneStore.loadZones())
    }

    @Test
    fun `unknown and cross-family recipient failures are generic and stop before crypto`() = runTest {
        var verifierCalls = 0
        val receiver = SafeZonePolicyReceiver(
            localFamilyId = "family-a",
            localEndpointId = "child-a",
            authority = authority(),
            signatureVerifier = object : SafeZoneEnvelopeSignatureVerifier {
                override suspend fun verify(envelope: SafeZonePolicyEnvelope, senderPublicSigningKey: String): Boolean {
                    verifierCalls += 1
                    return true
                }
            },
            decryptor = object : SafeZonePayloadDecryptor {
                override suspend fun decrypt(envelope: SafeZonePolicyEnvelope, senderPublicSigningKey: String): ByteArray? =
                    error("cross-family recipient must never reach decrypt")
            },
            zoneStore = zoneStore,
            zoneStateStore = zoneStateStore,
        )

        val crossFamily = receiver.receive(envelope(familyId = "family-b", recipientEndpointId = "child-b"), nowEpochMillis = 2_000L)
        val wrongRecipient = receiver.receive(envelope(recipientEndpointId = "child-b"), nowEpochMillis = 2_000L)

        assertEquals(SafeZonePolicyReceiveResult.REJECTED, crossFamily)
        assertEquals(SafeZonePolicyReceiveResult.REJECTED, wrongRecipient)
        assertEquals(0, verifierCalls)
        assertTrue(zoneStore.loadZones().isEmpty())
    }

    @Test
    fun `viewer and unknown sender are denied before policy application`() = runTest {
        val receiver = SafeZonePolicyReceiver(
            localFamilyId = "family-a",
            localEndpointId = "child-a",
            authority = authority(SafeZoneFamilyRole.VIEWER),
            signatureVerifier = approvingVerifier,
            decryptor = object : SafeZonePayloadDecryptor {
                override suspend fun decrypt(envelope: SafeZonePolicyEnvelope, senderPublicSigningKey: String): ByteArray? =
                    error("Viewer must never reach decrypt")
            },
            zoneStore = zoneStore,
            zoneStateStore = zoneStateStore,
        )

        assertEquals(SafeZonePolicyReceiveResult.REJECTED, receiver.receive(envelope(), nowEpochMillis = 2_000L))
        assertTrue(zoneStore.loadZones().isEmpty())
    }

    @Test
    fun `production crypto gate rejects without a plaintext fallback`() = runTest {
        val receiver = SafeZonePolicyReceiver(
            localFamilyId = "family-a",
            localEndpointId = "child-a",
            authority = authority(),
            signatureVerifier = approvingVerifier,
            decryptor = RejectingSafeZonePayloadDecryptor(),
            zoneStore = zoneStore,
            zoneStateStore = zoneStateStore,
        )

        assertEquals(SafeZonePolicyReceiveResult.BLOCKED_CRYPTO_REVIEW, receiver.receive(envelope(), nowEpochMillis = 2_000L))
        assertTrue(zoneStore.loadZones().isEmpty())
    }

    @Test
    fun `current key epoch is required before signature or decrypt`() = runTest {
        var verifierCalls = 0
        val receiver = SafeZonePolicyReceiver(
            localFamilyId = "family-a",
            localEndpointId = "child-a",
            authority = authority(),
            signatureVerifier = object : SafeZoneEnvelopeSignatureVerifier {
                override suspend fun verify(envelope: SafeZonePolicyEnvelope, senderPublicSigningKey: String): Boolean {
                    verifierCalls += 1
                    return true
                }
            },
            decryptor = object : SafeZonePayloadDecryptor {
                override suspend fun decrypt(envelope: SafeZonePolicyEnvelope, senderPublicSigningKey: String): ByteArray? =
                    error("stale key epoch must never reach decrypt")
            },
            zoneStore = zoneStore,
            zoneStateStore = zoneStateStore,
        )

        assertEquals(
            SafeZonePolicyReceiveResult.REJECTED,
            receiver.receive(envelope().copy(keyEpoch = 4L), nowEpochMillis = 2_000L),
        )
        assertEquals(0, verifierCalls)
    }

    @Test
    fun `out of range trust and key epochs are rejected before crypto`() = runTest {
        var verifierCalls = 0
        val receiver = SafeZonePolicyReceiver(
            localFamilyId = "family-a",
            localEndpointId = "child-a",
            authority = authority(),
            signatureVerifier = object : SafeZoneEnvelopeSignatureVerifier {
                override suspend fun verify(envelope: SafeZonePolicyEnvelope, senderPublicSigningKey: String): Boolean {
                    verifierCalls += 1
                    return true
                }
            },
            decryptor = object : SafeZonePayloadDecryptor {
                override suspend fun decrypt(envelope: SafeZonePolicyEnvelope, senderPublicSigningKey: String): ByteArray? =
                    error("out of range epochs must never reach decrypt")
            },
            zoneStore = zoneStore,
            zoneStateStore = zoneStateStore,
        )
        val aboveInt32 = Int.MAX_VALUE.toLong() + 1L

        assertEquals(SafeZonePolicyReceiveResult.REJECTED, receiver.receive(envelope().copy(trustSetEpoch = aboveInt32), 2_000L))
        assertEquals(SafeZonePolicyReceiveResult.REJECTED, receiver.receive(envelope().copy(keyEpoch = aboveInt32), 2_000L))
        assertEquals(0, verifierCalls)
    }

    @Test
    fun `payload key epoch codec bounds values and accepts integral JSON number forms`() {
        val payload = SafeZonePolicyPayload("family-a", "child-a", "zone-home", 1L, 3L, zone)
        val envelope = envelope()
        val encoded = String(SafeZonePolicyPayloadCodec.encode(payload), Charsets.UTF_8)
        val decimal = encoded.replace("\"keyEpoch\":3", "\"keyEpoch\":3.0")
        val exponent = encoded.replace("\"keyEpoch\":3", "\"keyEpoch\":3e0")
        val aboveInt32 = encoded.replace("\"keyEpoch\":3", "\"keyEpoch\":2147483648")

        assertEquals(payload, SafeZonePolicyPayloadCodec.decode(decimal.toByteArray(), envelope))
        assertEquals(payload, SafeZonePolicyPayloadCodec.decode(exponent.toByteArray(), envelope))
        assertNull(SafeZonePolicyPayloadCodec.decode(aboveInt32.toByteArray(), envelope))
        assertThrows(IllegalArgumentException::class.java) {
            SafeZonePolicyPayloadCodec.encode(payload.copy(keyEpoch = Int.MAX_VALUE.toLong() + 1L))
        }
    }

    @Test
    fun `payload revision enforces exact numeric value and shared unsigned counter bounds`() {
        val payload = SafeZonePolicyPayload("family-a", "child-a", "zone-home", 1L, 3L, zone)
        val envelope = envelope()
        val encoded = String(SafeZonePolicyPayloadCodec.encode(payload), Charsets.UTF_8)
        val fraction = encoded.replace("\"revision\":1", "\"revision\":1.5")
        val aboveUnsignedRange = encoded.replace("\"revision\":1", "\"revision\":4294967296")

        assertEquals(payload, SafeZonePolicyPayloadCodec.decode(encoded.toByteArray(), envelope))
        assertNull(SafeZonePolicyPayloadCodec.decode(fraction.toByteArray(), envelope))
        assertNull(SafeZonePolicyPayloadCodec.decode(aboveUnsignedRange.toByteArray(), envelope))

        val maxRevision = 4_294_967_295L
        val boundaryPayload = payload.copy(revision = maxRevision, zone = zone.copy(revision = maxRevision))
        val boundaryEnvelope = envelope.copy(revision = maxRevision)
        val boundaryEncoded = SafeZonePolicyPayloadCodec.encode(boundaryPayload)
        assertEquals(boundaryPayload, SafeZonePolicyPayloadCodec.decode(boundaryEncoded, boundaryEnvelope))
        assertThrows(IllegalArgumentException::class.java) {
            SafeZonePolicyPayloadCodec.encode(payload.copy(revision = maxRevision + 1L))
        }
    }

    @Test
    fun `payload decoder rejects duplicate names and malformed UTF8 instead of normalizing them`() {
        val payload = SafeZonePolicyPayload("family-a", "child-a", "zone-home", 1L, 3L, zone)
        val envelope = envelope()
        val encoded = String(SafeZonePolicyPayloadCodec.encode(payload), Charsets.UTF_8)
        val duplicate = encoded.replaceFirst("{", "{\"familyId\":\"family-other\",")
        val escapedAlias = encoded.replaceFirst("{", "{\"family\\u0049d\":\"family-other\",")
        val labelMarker = "\"label\":\""
        val labelStart = encoded.indexOf(labelMarker) + labelMarker.length
        assertTrue(labelStart >= labelMarker.length)
        val malformedUtf8 = encoded.substring(0, labelStart).toByteArray(Charsets.UTF_8) +
            byteArrayOf(0xC3.toByte(), 0x28) + encoded.substring(labelStart).toByteArray(Charsets.UTF_8)

        assertNull(SafeZonePolicyPayloadCodec.decode(duplicate.toByteArray(Charsets.UTF_8), envelope))
        assertNull(SafeZonePolicyPayloadCodec.decode(escapedAlias.toByteArray(Charsets.UTF_8), envelope))
        assertNull(SafeZonePolicyPayloadCodec.decode(malformedUtf8, envelope))
        assertEquals(payload, SafeZonePolicyPayloadCodec.decode(encoded.toByteArray(Charsets.UTF_8), envelope))
    }

    @Test
    fun `malformed location payload cannot be normalized into a stored policy`() = runTest {
        val receiver = SafeZonePolicyReceiver(
            localFamilyId = "family-a",
            localEndpointId = "child-a",
            authority = authority(),
            signatureVerifier = approvingVerifier,
            decryptor = object : SafeZonePayloadDecryptor {
                override suspend fun decrypt(envelope: SafeZonePolicyEnvelope, senderPublicSigningKey: String): ByteArray =
                    SafeZonePolicyPayloadCodec.encode(SafeZonePolicyPayload("family-a", "child-a", "zone-home", 1L, 3L, zone.copy(label = "Home|secret")))
            },
            zoneStore = zoneStore,
            zoneStateStore = zoneStateStore,
        )

        assertEquals(SafeZonePolicyReceiveResult.REJECTED, receiver.receive(envelope(), nowEpochMillis = 2_000L))
        assertTrue(zoneStore.loadZones().isEmpty())
    }

    @Test
    fun `verified owner payload applies locally and monitor emits only local entry notification`() = runTest {
        val stateStore = GeofenceZoneStateStore(backing, scopeProvider = scopeProvider)
        val receiver = SafeZonePolicyReceiver(
            localFamilyId = "family-a",
            localEndpointId = "child-a",
            authority = authority(),
            signatureVerifier = approvingVerifier,
            decryptor = object : SafeZonePayloadDecryptor {
                override suspend fun decrypt(envelope: SafeZonePolicyEnvelope, senderPublicSigningKey: String): ByteArray? =
                    envelope.payloadForTest()
            },
            zoneStore = zoneStore,
            zoneStateStore = stateStore,
        )

        assertEquals(SafeZonePolicyReceiveResult.APPLIED, receiver.receive(envelope(), nowEpochMillis = 2_000L))
        assertEquals(zone, zoneStore.loadZones().single())

        stateStore.save(GeofenceZoneState(zoneId = "zone-home", confirmedMembership = GeofenceMembership.OUTSIDE))
        val alerts = RecordingGeofenceAlertPort()
        val monitor = GeofenceMonitor(
            zoneStore = zoneStore,
            zoneStateStore = stateStore,
            alertPort = alerts,
            config = GeofenceConfig(hysteresisMeters = 0.0, requiredConsecutiveSamplesToConfirm = 1),
            currentBootInstanceId = { "boot-test" },
        )

        val events = monitor.evaluateSample(
            LocationSample(
                latitude = zone.centerLatitude,
                longitude = zone.centerLongitude,
                accuracyMeters = 5f,
                elapsedRealtimeMillis = 0L,
            ),
            1L,
        )

        assertEquals(1, events.size)
        assertEquals(GeofenceTransitionType.ENTRY, events.single().transitionType)
        assertEquals(1, alerts.delivered.size)
    }

    @Test
    fun `corrupt persisted zone snapshot blocks receive without resetting prior revision`() = runTest {
        val key = familyScope.zoneStoreKey("geofence_zones_v2")
        val corrupt = "zone-home|Home|25.0|55.0|100.0|true|ENTRY,EXIT|7\nnot|enough|fields"
        backing.putString(key, corrupt)
        val receiver = SafeZonePolicyReceiver(
            localFamilyId = "family-a",
            localEndpointId = "child-a",
            authority = authority(),
            signatureVerifier = approvingVerifier,
            decryptor = object : SafeZonePayloadDecryptor {
                override suspend fun decrypt(envelope: SafeZonePolicyEnvelope, senderPublicSigningKey: String): ByteArray? =
                    SafeZonePolicyPayloadCodec.encode(
                        SafeZonePolicyPayload("family-a", "child-a", "zone-home", 2L, 3L, zone.copy(revision = 2L)),
                    )
            },
            zoneStore = zoneStore,
            zoneStateStore = zoneStateStore,
        )

        assertEquals(
            SafeZonePolicyReceiveResult.REJECTED,
            receiver.receive(envelope().copy(revision = 2L), nowEpochMillis = 2_000L),
        )
        assertEquals(corrupt, backing.getString(key))
    }

    @Test
    fun `newer policy revision clears prior membership baseline before local monitoring`() = runTest {
        zoneStateStore.save(
            GeofenceZoneState(
                zoneId = zone.zoneId,
                confirmedMembership = GeofenceMembership.INSIDE,
            ),
        )
        val updatedZone = zone.copy(centerLatitude = 25.01, revision = 2L)
        val receiver = SafeZonePolicyReceiver(
            localFamilyId = "family-a",
            localEndpointId = "child-a",
            authority = authority(),
            signatureVerifier = approvingVerifier,
            decryptor = object : SafeZonePayloadDecryptor {
                override suspend fun decrypt(envelope: SafeZonePolicyEnvelope, senderPublicSigningKey: String): ByteArray =
                    SafeZonePolicyPayloadCodec.encode(SafeZonePolicyPayload("family-a", "child-a", zone.zoneId, 2L, 3L, updatedZone))
            },
            zoneStore = zoneStore,
            zoneStateStore = zoneStateStore,
        )

        assertEquals(
            SafeZonePolicyReceiveResult.APPLIED,
            receiver.receive(envelope().copy(revision = 2L), nowEpochMillis = 2_000L),
        )
        assertEquals(null, zoneStateStore.load(zone.zoneId))

        val alerts = RecordingGeofenceAlertPort()
        val monitor = GeofenceMonitor(
            zoneStore = zoneStore,
            zoneStateStore = zoneStateStore,
            alertPort = alerts,
            config = GeofenceConfig(hysteresisMeters = 0.0, requiredConsecutiveSamplesToConfirm = 1),
            currentBootInstanceId = { "boot-test" },
        )
        val events = monitor.evaluateSample(
            LocationSample(zone.centerLatitude, zone.centerLongitude, 5f, 0L),
            1L,
        )

        assertTrue(events.isEmpty())
        assertTrue(alerts.delivered.isEmpty())
        assertEquals(GeofenceMembership.OUTSIDE, zoneStateStore.load(zone.zoneId)?.confirmedMembership)
    }

    @Test
    fun `failed zone replacement restores prior accepted policy baseline`() = runTest {
        val failingBacking = OneShotZoneCandidateFailureStore(InMemoryPersistentStateStore())
        val zones = GeofenceZoneStore(failingBacking, scopeProvider = { familyScope })
        val states = GeofenceZoneStateStore(failingBacking, scopeProvider = { familyScope })
        zones.addOrReplace(zone)
        val priorBaseline = GeofenceZoneState(
            zoneId = zone.zoneId,
            confirmedMembership = GeofenceMembership.INSIDE,
            candidateMembership = GeofenceMembership.OUTSIDE,
            candidateStreak = 1,
            lastEvaluatedMonotonicNanos = 40L,
            lastAcceptedSampleElapsedRealtimeMillis = 35L,
            bootInstanceId = "boot-test",
        )
        states.save(priorBaseline)
        failingBacking.failNextCandidateKey = familyScope.zoneStoreKey("geofence_zones_v2")
        val replacement = zone.copy(centerLatitude = 25.01, revision = 2L)
        val receiver = SafeZonePolicyReceiver(
            localFamilyId = "family-a",
            localEndpointId = "child-a",
            authority = authority(),
            signatureVerifier = approvingVerifier,
            decryptor = object : SafeZonePayloadDecryptor {
                override suspend fun decrypt(envelope: SafeZonePolicyEnvelope, senderPublicSigningKey: String) =
                    SafeZonePolicyPayloadCodec.encode(
                        SafeZonePolicyPayload("family-a", "child-a", zone.zoneId, 2L, 3L, replacement),
                    )
            },
            zoneStore = zones,
            zoneStateStore = states,
        )

        assertEquals(
            SafeZonePolicyReceiveResult.REJECTED,
            receiver.receive(envelope().copy(revision = 2L), nowEpochMillis = 2_000L),
        )
        assertEquals(listOf(zone), zones.loadZones())
        assertEquals(priorBaseline, states.load(zone.zoneId))
    }

    @Test
    fun `failed first zone write does not restore orphan debounce state`() = runTest {
        val failingBacking = OneShotZoneCandidateFailureStore(InMemoryPersistentStateStore())
        val zones = GeofenceZoneStore(failingBacking, scopeProvider = { familyScope })
        val states = GeofenceZoneStateStore(failingBacking, scopeProvider = { familyScope })
        val orphanBaseline = GeofenceZoneState(
            zoneId = zone.zoneId,
            confirmedMembership = GeofenceMembership.INSIDE,
        )
        states.save(orphanBaseline)
        failingBacking.failNextCandidateKey = familyScope.zoneStoreKey("geofence_zones_v2")
        val receiver = SafeZonePolicyReceiver(
            localFamilyId = "family-a",
            localEndpointId = "child-a",
            authority = authority(),
            signatureVerifier = approvingVerifier,
            decryptor = object : SafeZonePayloadDecryptor {
                override suspend fun decrypt(envelope: SafeZonePolicyEnvelope, senderPublicSigningKey: String) =
                    SafeZonePolicyPayloadCodec.encode(
                        SafeZonePolicyPayload("family-a", "child-a", zone.zoneId, 1L, 3L, zone),
                    )
            },
            zoneStore = zones,
            zoneStateStore = states,
        )

        assertEquals(SafeZonePolicyReceiveResult.REJECTED, receiver.receive(envelope(), nowEpochMillis = 2_000L))
        assertTrue(zones.loadZones().isEmpty())
        assertNull(states.load(zone.zoneId))
    }

    @Test
    fun `deleted zone replay and key epoch rollback stay rejected after process restart`() = runTest {
        val flexibleAuthority = object : SafeZoneFamilyAuthority {
            override suspend fun isRecipientAuthorized(
                familyId: String,
                recipientEndpointId: String,
                trustSetEpoch: Long,
                keyEpoch: Long,
            ) = familyId == "family-a" && recipientEndpointId == "child-a" && trustSetEpoch == 2L && keyEpoch > 0L

            override suspend fun resolveAuthorizedSender(
                familyId: String,
                senderDeviceId: String,
                senderKeyId: String,
                trustSetEpoch: Long,
                keyEpoch: Long,
            ) = if (isRecipientAuthorized(familyId, "child-a", trustSetEpoch, keyEpoch) &&
                senderDeviceId == "parent-a" && senderKeyId == "parent-signing-key") {
                SafeZoneAuthorizedSender(SafeZoneFamilyRole.OWNER, "parent-public-key")
            } else null
        }

        suspend fun apply(payload: SafeZonePolicyPayload, zones: GeofenceZoneStore, states: GeofenceZoneStateStore) =
            SafeZonePolicyReceiver(
                "family-a", "child-a", flexibleAuthority, approvingVerifier,
                object : SafeZonePayloadDecryptor {
                    override suspend fun decrypt(envelope: SafeZonePolicyEnvelope, senderPublicSigningKey: String) =
                        SafeZonePolicyPayloadCodec.encode(payload)
                },
                zones, states,
            ).receive(envelope().copy(zoneId = payload.zoneId, revision = payload.revision, keyEpoch = payload.keyEpoch), 2_000L)

        val initial = SafeZonePolicyPayload("family-a", "child-a", "zone-home", 1L, 4L, zone.copy(revision = 1L))
        assertEquals(SafeZonePolicyReceiveResult.APPLIED, apply(initial, zoneStore, zoneStateStore))
        zoneStateStore.save(GeofenceZoneState(zoneId = "zone-home", confirmedMembership = GeofenceMembership.INSIDE))
        zoneStore.remove("zone-home")

        // Reconstruct both stores as Android would after process death. The tombstone and
        // accepted key-epoch floor must survive independently of the active zone row.
        val reopenedZones = GeofenceZoneStore(backing, scopeProvider = scopeProvider)
        val reopenedStates = GeofenceZoneStateStore(backing, scopeProvider = scopeProvider)
        assertTrue(reopenedZones.loadZones().isEmpty())
        assertEquals(1L, reopenedZones.revisionFloor(familyScope, "zone-home"))
        assertEquals(4L, reopenedZones.acceptedKeyEpochFloor(familyScope))
        assertEquals(SafeZonePolicyReceiveResult.REJECTED, apply(initial, reopenedZones, reopenedStates))
        assertTrue(reopenedZones.loadZones().isEmpty())

        val restored = initial.copy(revision = 2L, zone = zone.copy(revision = 2L))
        assertEquals(SafeZonePolicyReceiveResult.APPLIED, apply(restored, reopenedZones, reopenedStates))
        assertNull(reopenedStates.load("zone-home"))

        val otherZoneRollback = SafeZonePolicyPayload(
            "family-a", "child-a", "zone-school", 1L, 3L, zone.copy(zoneId = "zone-school", revision = 1L),
        )
        assertEquals(SafeZonePolicyReceiveResult.REJECTED, apply(otherZoneRollback, reopenedZones, reopenedStates))
        assertTrue(reopenedZones.loadZones().none { it.zoneId == "zone-school" })

        val currentEpoch = otherZoneRollback.copy(keyEpoch = 5L)
        assertEquals(SafeZonePolicyReceiveResult.APPLIED, apply(currentEpoch, reopenedZones, reopenedStates))
        assertEquals(setOf("zone-home", "zone-school"), reopenedZones.loadZones().map { it.zoneId }.toSet())
        assertEquals(5L, reopenedZones.acceptedKeyEpochFloor(familyScope))
    }

    @Test
    fun `disabled policy is stored locally but cannot manufacture an exit alert`() = runTest {
        val disabledZone = zone.copy(enabled = false, transitionTypes = setOf(GeofenceTransitionType.EXIT))
        val stateStore = GeofenceZoneStateStore(backing, scopeProvider = scopeProvider)
        val receiver = SafeZonePolicyReceiver(
            localFamilyId = "family-a",
            localEndpointId = "child-a",
            authority = authority(),
            signatureVerifier = approvingVerifier,
            decryptor = object : SafeZonePayloadDecryptor {
                override suspend fun decrypt(envelope: SafeZonePolicyEnvelope, senderPublicSigningKey: String): ByteArray? =
                    SafeZonePolicyPayloadCodec.encode(SafeZonePolicyPayload("family-a", "child-a", "zone-home", 1L, 3L, disabledZone))
            },
            zoneStore = zoneStore,
            zoneStateStore = stateStore,
        )

        assertEquals(SafeZonePolicyReceiveResult.APPLIED, receiver.receive(envelope(), nowEpochMillis = 2_000L))
        stateStore.save(GeofenceZoneState(zoneId = "zone-home", confirmedMembership = GeofenceMembership.INSIDE))
        val alerts = RecordingGeofenceAlertPort()
        val monitor = GeofenceMonitor(zoneStore, stateStore, alerts, GeofenceConfig(requiredConsecutiveSamplesToConfirm = 1)) { "boot-test" }
        monitor.evaluateSample(
            LocationSample(zone.centerLatitude + Math.toDegrees(500.0 / 6_371_000.0), zone.centerLongitude, 5f, 0L),
            1L,
        )

        assertTrue(alerts.delivered.isEmpty())
        assertEquals(false, zoneStore.loadZones().single().enabled)
    }

    @Test
    fun `receiver captured for previous family cannot read or replace current family policy`() = runTest {
        val receiver = SafeZonePolicyReceiver(
            localFamilyId = "family-a",
            localEndpointId = "child-a",
            authority = authority(),
            signatureVerifier = approvingVerifier,
            decryptor = object : SafeZonePayloadDecryptor {
                override suspend fun decrypt(envelope: SafeZonePolicyEnvelope, senderPublicSigningKey: String): ByteArray =
                    envelope.payloadForTest()
            },
            zoneStore = zoneStore,
            zoneStateStore = zoneStateStore,
        )
        assertEquals(SafeZonePolicyReceiveResult.APPLIED, receiver.receive(envelope(), 2_000L))

        activeScope = GeofenceStorageScope("family-b", "child-b")
        assertTrue(zoneStore.loadZones().isEmpty())
        assertEquals(
            SafeZonePolicyReceiveResult.REJECTED,
            receiver.receive(envelope().copy(revision = 2L), 2_000L),
        )
        assertTrue(zoneStore.loadZones().isEmpty())

        val restartedFamilyAStore = GeofenceZoneStore(backing, scopeProvider = { familyScope })
        assertEquals("Home", restartedFamilyAStore.loadZones().single().label)
    }

    private fun SafeZonePolicyEnvelope.payloadForTest(): ByteArray =
        SafeZonePolicyPayloadCodec.encode(SafeZonePolicyPayload(familyId, recipientEndpointId, zoneId, revision, keyEpoch, zone))

    private class OneShotZoneCandidateFailureStore(
        private val delegate: PersistentStateStore,
    ) : PersistentStateStore {
        override val coordinationLock: Any get() = delegate.coordinationLock
        var failNextCandidateKey: String? = null

        override fun getString(key: String): String? = delegate.getString(key)
        override fun putString(key: String, value: String) {
            if (key == failNextCandidateKey) {
                failNextCandidateKey = null
                error("injected Safe Zone candidate write failure")
            }
            delegate.putString(key, value)
        }
        override fun remove(key: String) = delegate.remove(key)
        override fun contains(key: String): Boolean = delegate.contains(key)
        override fun clear() = delegate.clear()
        override fun flush() = delegate.flush()
    }
}
