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
                return envelope.ciphertext.contentEquals(byteArrayOf(1, 2, 3)) && envelope.nonce.contentEquals(byteArrayOf(4, 5, 6))
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
                    assertTrue(envelope.nonce.contentEquals(byteArrayOf(4, 5, 6)))
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
        nonce = byteArrayOf(4, 5, 6),
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
        val monitor = GeofenceMonitor(zoneStore, stateStore, alerts, GeofenceConfig(requiredConsecutiveSamplesToConfirm = 1))
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
}
