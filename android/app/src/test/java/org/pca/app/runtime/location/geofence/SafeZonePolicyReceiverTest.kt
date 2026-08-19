package org.pca.app.runtime.location.geofence

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.pca.app.foundation.InMemoryPersistentStateStore
import org.pca.app.platform.LocationSample

class SafeZonePolicyReceiverTest {

    private val zoneStore = GeofenceZoneStore(InMemoryPersistentStateStore())
    private val zoneStateStore = GeofenceZoneStateStore(InMemoryPersistentStateStore())

    private val zone = GeofenceZone(
        zoneId = "zone-home",
        label = "Home",
        centerLatitude = 25.0,
        centerLongitude = 55.0,
        radiusMeters = 100.0,
        enabled = true,
        transitionTypes = setOf(GeofenceTransitionType.ENTRY),
    )

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
        val stateStore = GeofenceZoneStateStore(InMemoryPersistentStateStore())
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
        val stateStore = GeofenceZoneStateStore(InMemoryPersistentStateStore())
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

    private fun SafeZonePolicyEnvelope.payloadForTest(): ByteArray =
        SafeZonePolicyPayloadCodec.encode(SafeZonePolicyPayload(familyId, recipientEndpointId, zoneId, revision, keyEpoch, zone))
}
