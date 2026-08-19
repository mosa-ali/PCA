package org.pca.app.runtime.location.geofence

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.pca.app.foundation.InMemoryPersistentStateStore
import org.pca.app.platform.LocationSample

class SafeZoneRuntimeTest {

    private val zone = GeofenceZone(
        zoneId = "zone-home",
        label = "Home",
        centerLatitude = 25.0,
        centerLongitude = 55.0,
        radiusMeters = 100.0,
        transitionTypes = setOf(GeofenceTransitionType.ENTRY),
    )

    private fun envelope() = SafeZonePolicyEnvelope(
        familyId = "family-a",
        recipientEndpointId = "child-a",
        senderDeviceId = "parent-a",
        senderKeyId = "parent-signing-key",
        trustSetEpoch = 2L,
        keyEpoch = 3L,
        revision = 1L,
        zoneId = zone.zoneId,
        ciphertext = byteArrayOf(1, 2, 3),
        nonce = byteArrayOf(4, 5, 6),
        signature = "signature",
        issuedAtEpochMillis = 1_000L,
        expiresAtEpochMillis = 10_000L,
    )

    private val authority = object : SafeZoneFamilyAuthority {
        override suspend fun isRecipientAuthorized(
            familyId: String,
            recipientEndpointId: String,
            trustSetEpoch: Long,
            keyEpoch: Long,
        ): Boolean = familyId == "family-a" && recipientEndpointId == "child-a" && trustSetEpoch == 2L && keyEpoch == 3L

        override suspend fun resolveAuthorizedSender(
            familyId: String,
            senderDeviceId: String,
            senderKeyId: String,
            trustSetEpoch: Long,
            keyEpoch: Long,
        ): SafeZoneAuthorizedSender? = if (
            familyId == "family-a" && senderDeviceId == "parent-a" && senderKeyId == "parent-signing-key" &&
            trustSetEpoch == 2L && keyEpoch == 3L
        ) {
            SafeZoneAuthorizedSender(SafeZoneFamilyRole.OWNER, "parent-public-key")
        } else {
            null
        }
    }

    @Test
    fun `accepted policy reaches local geofence alert port`() = runTest {
        val zoneStore = GeofenceZoneStore(InMemoryPersistentStateStore())
        val stateStore = GeofenceZoneStateStore(InMemoryPersistentStateStore())
        stateStore.save(GeofenceZoneState(zone.zoneId, confirmedMembership = GeofenceMembership.OUTSIDE))
        val alerts = RecordingGeofenceAlertPort()
        val runtime = SafeZoneRuntime(
            SafeZonePolicyReceiver(
                localFamilyId = "family-a",
                localEndpointId = "child-a",
                authority = authority,
                signatureVerifier = object : SafeZoneEnvelopeSignatureVerifier {
                    override suspend fun verify(envelope: SafeZonePolicyEnvelope, senderPublicSigningKey: String): Boolean =
                        senderPublicSigningKey == "parent-public-key" && envelope.signature == "signature"
                },
                decryptor = object : SafeZonePayloadDecryptor {
                    override suspend fun decrypt(envelope: SafeZonePolicyEnvelope, senderPublicSigningKey: String): ByteArray =
                        SafeZonePolicyPayloadCodec.encode(SafeZonePolicyPayload("family-a", "child-a", zone.zoneId, 1L, 3L, zone))
                },
                zoneStore = zoneStore,
            ),
            GeofenceMonitor(
                zoneStore,
                stateStore,
                alerts,
                GeofenceConfig(hysteresisMeters = 0.0, requiredConsecutiveSamplesToConfirm = 1),
            ),
        )

        assertEquals(SafeZonePolicyReceiveResult.APPLIED, runtime.receivePolicy(envelope(), 2_000L))
        val events = runtime.evaluateSample(
            LocationSample(zone.centerLatitude, zone.centerLongitude, 5f, 0L),
            1L,
        )

        assertEquals(GeofenceTransitionType.ENTRY, events.single().transitionType)
        assertEquals(events, alerts.delivered)
    }

    @Test
    fun `crypto-gated policy never creates a local zone or alert`() = runTest {
        val zoneStore = GeofenceZoneStore(InMemoryPersistentStateStore())
        val alerts = RecordingGeofenceAlertPort()
        val runtime = SafeZoneRuntime(
            SafeZonePolicyReceiver(
                localFamilyId = "family-a",
                localEndpointId = "child-a",
                authority = authority,
                signatureVerifier = object : SafeZoneEnvelopeSignatureVerifier {
                    override suspend fun verify(envelope: SafeZonePolicyEnvelope, senderPublicSigningKey: String): Boolean = true
                },
                decryptor = RejectingSafeZonePayloadDecryptor(),
                zoneStore = zoneStore,
            ),
            GeofenceMonitor(
                zoneStore,
                GeofenceZoneStateStore(InMemoryPersistentStateStore()),
                alerts,
            ),
        )

        assertEquals(SafeZonePolicyReceiveResult.BLOCKED_CRYPTO_REVIEW, runtime.receivePolicy(envelope(), 2_000L))
        assertTrue(runtime.evaluateSample(LocationSample(zone.centerLatitude, zone.centerLongitude, 5f, 0L), 1L).isEmpty())
        assertTrue(alerts.delivered.isEmpty())
    }
}
