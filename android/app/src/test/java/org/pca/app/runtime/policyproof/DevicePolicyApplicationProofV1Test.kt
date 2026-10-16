package org.pca.app.runtime.policyproof

import java.math.BigInteger
import java.util.Base64
import java.time.Instant
import org.pca.app.foundation.InMemoryPersistentStateStore
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import org.pca.app.runtime.sync.envelope.FamilyEnvelope
import org.pca.app.runtime.sync.envelope.RecipientBinding

class DevicePolicyApplicationProofV1Test {
    private val envelope = FamilyEnvelope(
        protocolMajor = 1,
        protocolMinor = 0,
        messageId = "11111111-1111-4111-8111-111111111111",
        familyId = "22222222-2222-4222-8222-222222222222",
        senderDeviceId = "33333333-3333-4333-8333-333333333333",
        recipient = RecipientBinding.Device("44444444-4444-4444-8444-444444444444"),
        senderKeyId = "55555555-5555-4555-8555-555555555555",
        messageType = "POLICY_UPDATE",
        trustSetEpoch = 7,
        keyEpoch = 9,
        sequenceOrNonce = "1",
        issuedAtEpochMillis = 1_792_025_700_000,
        expiresAtEpochMillis = 1_792_029_300_000,
        semanticVersion = "1.2.3",
        correlationId = null,
        payload = byteArrayOf(0, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88.toByte(), 0x99.toByte(), 0xaa.toByte(), 0xbb.toByte(), 0xcc.toByte(), 0xdd.toByte(), 0xee.toByte(), 0xff.toByte()),
        signature = "fixture-signature-not-used-for-canonicalization",
    )

    private val expectedEnvelopeCanonicalBase64Url =
        "MToxMTowMzY6MTExMTExMTEtMTExMS00MTExLTgxMTEtMTExMTExMTExMTExMzY6MjIyMjIyMjItMjIyMi00MjIyLTgyMjItMjIyMjIyMjIyMjIyMzY6MzMzMzMzMzMtMzMzMy00MzMzLTgzMzMtMzMzMzMzMzMzMzMzNjpERVZJQ0UzNjo0NDQ0NDQ0NC00NDQ0LTQ0NDQtODQ0NC00NDQ0NDQ0NDQ0NDQzNjo1NTU1NTU1NS01NTU1LTQ1NTUtODU1NS01NTU1NTU1NTU1NTUxMzpQT0xJQ1lfVVBEQVRFMToxMjQ6MjAyNi0xMC0xNVQwMDo1NTowMC4wMDBaMjQ6MjAyNi0xMC0xNVQwMTo1NTowMC4wMDBaMTo3MTo5NToxLjIuMzE6MDA6MjQ6QUJFaU0wUlZabmVJbWFxN3pOM3Uvdz09"

    private val expectedProofTranscriptBase64Url =
        "Mzg6UENBX0RFVklDRV9QT0xJQ1lfQVBQTElDQVRJT05fUFJPT0ZfVjEzNjoyMjIyMjIyMi0yMjIyLTQyMjItODIyMi0yMjIyMjIyMjIyMjIzNjo0NDQ0NDQ0NC00NDQ0LTQ0NDQtODQ0NC00NDQ0NDQ0NDQ0NDQzNjoxMTExMTExMS0xMTExLTQxMTEtODExMS0xMTExMTExMTExMTE0MzpNcDZkOFJqc2NrWVJ5ZGZPLU1IWmR1bWEydnl5clRqc0FGMFlBbEhjRHVjMTo3MTo5NzpBUFBMSUVEMzY6NjY2NjY2NjYtNjY2Ni00NjY2LTg2NjYtNjY2NjY2NjY2NjY2NDM6b0tHaW82U2xwcWVvcWFxcnJLMnVyN0N4c3JPMHRiYTN1TG02dTd5OXZyODI0OjIwMjYtMTAtMTVUMDA6NTY6MDAuMDAwWg"
    private val expectedVectorSignatureBase64Url =
        "qOnaqSm9irglYluuawYON6vfK8kTt75IaYXslvmTXHsIitr620VP4ZsvKSlZBHwRtWKuGP7HW3wDhT2O7ShJiw"

    private val fields = DevicePolicyApplicationProofV1.ProofFields(
        familyId = "22222222-2222-4222-8222-222222222222",
        deviceId = "44444444-4444-4444-8444-444444444444",
        policyEnvelopeMessageId = "11111111-1111-4111-8111-111111111111",
        policyEnvelopeSha256Base64Url = "Mp6d8RjsckYRydfO-MHZduma2vyyrTjsAF0YAlHcDuc",
        trustSetEpoch = 7,
        keyEpoch = 9,
        applicationResult = DevicePolicyApplicationProofV1.ApplicationResult.APPLIED,
        challenge = DevicePolicyApplicationProofV1.Challenge(
            challengeId = "66666666-6666-4666-8666-666666666666",
            nonceBase64Url = "oKGio6SlpqeoqaqrrK2ur7CxsrO0tba3uLm6u7y9vr8",
            expiresAt = "2026-10-15T00:56:00.000Z",
        ),
    )

    @Test
    fun canonicalEnvelopeAndDigestMatchFrozenBackendVector() {
        val canonical = DevicePolicyApplicationProofV1.canonicalEnvelopeBytes(envelope)
        assertEquals(expectedEnvelopeCanonicalBase64Url, Base64.getUrlEncoder().withoutPadding().encodeToString(canonical))
        assertEquals("Mp6d8RjsckYRydfO-MHZduma2vyyrTjsAF0YAlHcDuc", DevicePolicyApplicationProofV1.envelopeSha256Base64Url(envelope))
    }

    @Test
    fun proofTranscriptMatchesFrozenVector() {
        val canonical = DevicePolicyApplicationProofV1.canonicalTranscript(fields)
        assertEquals(expectedProofTranscriptBase64Url, DevicePolicyApplicationProofV1.encodeBase64Url(canonical))
    }

    @Test
    fun sharedSyntheticVectorSignatureIsCanonicalLowSP1363() {
        DevicePolicyApplicationProofV1.validateCanonicalSignature(
            Base64.getUrlDecoder().decode(expectedVectorSignatureBase64Url),
        )
        assertEquals(expectedVectorSignatureBase64Url,
            Base64.getUrlEncoder().withoutPadding().encodeToString(Base64.getUrlDecoder().decode(expectedVectorSignatureBase64Url)))
    }

    @Test
    fun envelopeDigestMutationChangesProofTranscript() {
        val original = DevicePolicyApplicationProofV1.canonicalTranscript(fields)
        val digest = DevicePolicyApplicationProofV1.decode32ByteBase64Url(fields.policyEnvelopeSha256Base64Url)
        digest[0] = (digest[0].toInt() xor 1).toByte()
        val changed = fields.copy(policyEnvelopeSha256Base64Url = DevicePolicyApplicationProofV1.encodeBase64Url(digest))
        assertNotEquals(original.toList(), DevicePolicyApplicationProofV1.canonicalTranscript(changed).toList())
    }

    @Test
    fun activationTargetGuardRequiresPolicyUpdateAndExactDeviceRecipient() {
        DevicePolicyApplicationProofV1.requireActivationTargetEnvelope(
            envelope,
            envelope.familyId,
            "44444444-4444-4444-8444-444444444444",
        )
        assertThrows(IllegalArgumentException::class.java) {
            DevicePolicyApplicationProofV1.requireActivationTargetEnvelope(envelope, envelope.familyId, "99999999-9999-4999-8999-999999999999")
        }
        assertThrows(IllegalArgumentException::class.java) {
            DevicePolicyApplicationProofV1.requireActivationTargetEnvelope(
                envelope.copy(messageType = "POLICY_RECEIPT"),
                envelope.familyId,
                "44444444-4444-4444-8444-444444444444",
            )
        }
    }

    @Test
    fun rejectsNonCanonicalUuidEpochAndBase64Url() {
        assertThrows(IllegalArgumentException::class.java) {
            DevicePolicyApplicationProofV1.canonicalTranscript(
                fields.copy(familyId = fields.familyId.replaceFirst("2", "A")),
            )
        }
        assertThrows(IllegalArgumentException::class.java) {
            DevicePolicyApplicationProofV1.canonicalTranscript(fields.copy(keyEpoch = 0))
        }
        assertThrows(IllegalArgumentException::class.java) {
            DevicePolicyApplicationProofV1.canonicalTranscript(fields.copy(policyEnvelopeSha256Base64Url = fields.policyEnvelopeSha256Base64Url + "="))
        }
    }

    @Test
    fun proofTranscriptBytesAreUtf8AndSignatureInputIsNotPreHashed() {
        assertArrayEquals(
            DevicePolicyApplicationProofV1.canonicalTranscript(fields),
            String(DevicePolicyApplicationProofV1.canonicalTranscript(fields), Charsets.UTF_8).toByteArray(Charsets.UTF_8),
        )
        assertEquals(32, DevicePolicyApplicationProofV1.transcriptSha256(fields).size)
    }

    @Test
    fun signerReceivesTranscriptBytesAndRejectsMalformedOrHighSSignatures() {
        var observed: ByteArray? = null
        val signableFields = fields.copy(applicationResult = DevicePolicyApplicationProofV1.ApplicationResult.DEGRADED)
        val validLowS = ByteArray(64).also { it[31] = 1; it[63] = 1 }
        val signer = object : CurrentDeviceDskProofSigner {
            override fun signProof(fields: DevicePolicyApplicationProofV1.ProofFields, canonicalTranscript: ByteArray): ByteArray {
                assertEquals(signableFields, fields)
                observed = canonicalTranscript.copyOf()
                return validLowS
            }
            override fun signBootstrapNonce(familyId: String, deviceId: String, nonceBase64Url: String) = validLowS
        }
        val signed = DevicePolicyApplicationProofV1.sign(signableFields, signer)
        assertArrayEquals(DevicePolicyApplicationProofV1.canonicalTranscript(signableFields), observed)
        assertEquals(DevicePolicyApplicationProofV1.encodeBase64Url(validLowS), signed.signatureBase64Url)

        val highSSigner = object : CurrentDeviceDskProofSigner {
            override fun signProof(fields: DevicePolicyApplicationProofV1.ProofFields, canonicalTranscript: ByteArray): ByteArray = ByteArray(64).also {
                it[31] = 1
                BigInteger("7FFFFFFF800000007FFFFFFFFFFFFFFFDE737D56D38BCF4279DCE5617E3192A9", 16)
                    .toByteArray()
                    .copyInto(it, destinationOffset = 32)
            }
            override fun signBootstrapNonce(familyId: String, deviceId: String, nonceBase64Url: String) = ByteArray(64)
        }
        assertThrows(IllegalArgumentException::class.java) {
            DevicePolicyApplicationProofV1.sign(signableFields, highSSigner)
        }
        val malformedSigner = object : CurrentDeviceDskProofSigner {
            override fun signProof(fields: DevicePolicyApplicationProofV1.ProofFields, canonicalTranscript: ByteArray) = byteArrayOf(1, 2, 3)
            override fun signBootstrapNonce(familyId: String, deviceId: String, nonceBase64Url: String) = byteArrayOf(1, 2, 3)
        }
        assertThrows(IllegalArgumentException::class.java) {
            DevicePolicyApplicationProofV1.sign(signableFields, malformedSigner)
        }
        assertThrows(IllegalArgumentException::class.java) {
            DevicePolicyApplicationProofV1.sign(fields, signer)
        }
    }

    @Test
    fun outboxPersistsExactRetryAcrossRecreationAndExpiresAfterFourteenDays() {
        val store = InMemoryPersistentStateStore()
        val outbox = PersistentDevicePolicyApplicationProofOutbox(store)
        val signature = ByteArray(64).also { it[31] = 1; it[63] = 1 }
        val pending = PersistentDevicePolicyApplicationProofOutbox.PendingProof(
            fields = fields.copy(applicationResult = DevicePolicyApplicationProofV1.ApplicationResult.DEGRADED),
            signatureBase64Url = DevicePolicyApplicationProofV1.encodeBase64Url(signature),
            createdAtEpochMillis = Instant.parse("2026-10-15T00:55:00.000Z").toEpochMilli(),
        )
        val now = Instant.parse("2026-10-15T00:55:30.000Z").toEpochMilli()
        val first = outbox.enqueue(pending, now)
        val reloaded = PersistentDevicePolicyApplicationProofOutbox(store)
        val retried = reloaded.pending(Instant.parse("2026-10-15T00:56:01.000Z").toEpochMilli()).single()
        assertEquals(first, retried) // response-lost retry remains byte-identical after challenge expiry
        assertEquals(first.requestFingerprintBase64Url(), retried.requestFingerprintBase64Url())
        assertThrows(DevicePolicyApplicationProofOutboxUnavailable::class.java) {
            reloaded.enqueue(pending.copy(signatureBase64Url = DevicePolicyApplicationProofV1.encodeBase64Url(ByteArray(64).also { it[31] = 1; it[63] = 2 })), now)
        }
        assertThrows(DevicePolicyApplicationProofOutboxUnavailable::class.java) { reloaded.enqueue(pending, pending.createdAtEpochMillis + 14L * 24 * 60 * 60 * 1000) }
        assertEquals(emptyList<PersistentDevicePolicyApplicationProofOutbox.PendingProof>(),
            reloaded.pending(pending.createdAtEpochMillis + 14L * 24 * 60 * 60 * 1000))
    }

    @Test
    fun activationApiUsesTypedRoutesAndNonceStringPop() {
        val expires = java.time.format.DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'")
            .withZone(java.time.ZoneOffset.UTC).format(Instant.now().plusSeconds(300))
        val challenge = DevicePolicyApplicationProofV1.Challenge(
            "77777777-7777-4777-8777-777777777777", "oKGio6SlpqeoqaqrrK2ur7CxsrO0tba3uLm6u7y9vr8", expires)
        val requests = mutableListOf<Pair<String, org.json.JSONObject>>()
        val sessionToken = "A".repeat(48)
        val bearerTokens = mutableListOf<String>()
        val transport = object : DevicePolicyActivationHttpTransport {
            override fun post(path: String, body: ByteArray): ByteArray {
                val request = org.json.JSONObject(String(body, Charsets.UTF_8))
                requests += path to request
                return when (path) {
                "/v1/device-policy-activation/bootstrap/challenge" -> org.json.JSONObject()
                    .put("challengeId", challenge.challengeId).put("nonce", challenge.nonceBase64Url).put("expiresAt", expires)
                "/v1/device-policy-activation/bootstrap/complete" -> org.json.JSONObject()
                    .put("challengeId", challenge.challengeId).put("nonce", challenge.nonceBase64Url).put("expiresAt", expires)
                    .put("sessionToken", sessionToken).put("sessionExpiresAt", Instant.now().plusSeconds(600).toString())
                    .put("policyEnvelopeMessageId", envelope.messageId)
                    .put("policyEnvelopeSha256", fields.policyEnvelopeSha256Base64Url).put("trustSetEpoch", 7).put("keyEpoch", 9)
                "/v1/device-policy-activation/bootstrap/fetch" -> org.json.JSONObject()
                    .put("challengeId", challenge.challengeId).put("policyEnvelopeMessageId", envelope.messageId)
                    .put("policyEnvelopeSha256", fields.policyEnvelopeSha256Base64Url)
                    .put("canonicalEnvelopeBytes", expectedEnvelopeCanonicalBase64Url)
                    .put("envelopeSignature", "sender-signature").put("trustSetEpoch", 7).put("keyEpoch", 9)
                "/v1/device-policy-activation/proof", "/v1/device-policy-activation/proof/status" ->
                    org.json.JSONObject().put("outcome", "RECORDED_NOT_ACTIVATED").put("idempotent", false)
                else -> throw AssertionError("unexpected activation route")
            }.toString().toByteArray(Charsets.UTF_8)
            }

            override fun postAuthenticated(path: String, body: ByteArray, bearerToken: String): ByteArray {
                bearerTokens += bearerToken
                return post(path, body)
            }
        }
        val api = DevicePolicyActivationApi(transport)
        val received = api.challenge(fields.familyId, fields.deviceId)
        var popBytes: ByteArray? = null
        val signer = object : CurrentDeviceDskProofSigner {
            override fun signProof(fields: DevicePolicyApplicationProofV1.ProofFields, canonicalTranscript: ByteArray) = ByteArray(64).also { it[31] = 1; it[63] = 1 }
            override fun signBootstrapNonce(familyId: String, deviceId: String, nonceBase64Url: String): ByteArray {
                assertEquals(fields.familyId, familyId); assertEquals(fields.deviceId, deviceId)
                popBytes = nonceBase64Url.toByteArray(Charsets.UTF_8)
                return ByteArray(64).also { it[31] = 1; it[63] = 1 }
            }
        }
        val session = api.complete(fields.familyId, fields.deviceId, received, signer)
        assertArrayEquals(received.nonceBase64Url.toByteArray(Charsets.UTF_8), popBytes)
        assertEquals(sessionToken, session.sessionToken)
        val target = api.fetch(session)
        assertArrayEquals(DevicePolicyApplicationProofV1.canonicalEnvelopeBytes(envelope), target.canonicalEnvelopeBytes)
        val nonApplied = fields.copy(applicationResult = DevicePolicyApplicationProofV1.ApplicationResult.DEGRADED, challenge = session.challenge)
        assertEquals("RECORDED_NOT_ACTIVATED", api.submit(session, nonApplied, DevicePolicyApplicationProofV1.encodeBase64Url(ByteArray(64).also { it[31] = 1; it[63] = 1 })).outcome)
        assertEquals("RECORDED_NOT_ACTIVATED", api.recover(session, session.challenge.challengeId, DevicePolicyApplicationProofV1.encodeBase64Url(ByteArray(32))).outcome)
        assertEquals(5, requests.size)
        assertEquals(listOf(sessionToken, sessionToken, sessionToken), bearerTokens)
        assertTrue(requests.all { !it.second.has("authorization") && !it.second.has("token") })
        assertEquals(setOf("familyId", "deviceId", "challengeId", "nonce", "signature"), requests[1].second.keys().asSequence().toSet())
        assertEquals(setOf("challengeId", "exactRequestSha256"), requests.last().second.keys().asSequence().toSet())
    }

    @Test
    fun productionBootstrapSequenceReachesCryptoGateAndRemainsBlocked() {
        val now = Instant.now()
        val expires = java.time.format.DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'")
            .withZone(java.time.ZoneOffset.UTC).format(now.plusSeconds(300))
        val challenge = DevicePolicyApplicationProofV1.Challenge(
            "77777777-7777-4777-8777-777777777777", "oKGio6SlpqeoqaqrrK2ur7CxsrO0tba3uLm6u7y9vr8", expires)
        val sessionToken = "A".repeat(48)
        val paths = mutableListOf<String>()
        val transport = object : DevicePolicyActivationHttpTransport {
            override fun post(path: String, body: ByteArray): ByteArray {
                paths += path
                val response = when (path) {
                    "/v1/device-policy-activation/bootstrap/challenge" -> org.json.JSONObject()
                        .put("challengeId", challenge.challengeId).put("nonce", challenge.nonceBase64Url).put("expiresAt", expires)
                    "/v1/device-policy-activation/bootstrap/complete" -> org.json.JSONObject()
                        .put("challengeId", challenge.challengeId).put("nonce", challenge.nonceBase64Url).put("expiresAt", expires)
                        .put("sessionToken", sessionToken).put("sessionExpiresAt", now.plusSeconds(600).toString())
                        .put("policyEnvelopeMessageId", envelope.messageId)
                        .put("policyEnvelopeSha256", fields.policyEnvelopeSha256Base64Url).put("trustSetEpoch", 7).put("keyEpoch", 9)
                    "/v1/device-policy-activation/bootstrap/fetch" -> org.json.JSONObject()
                        .put("challengeId", challenge.challengeId).put("policyEnvelopeMessageId", envelope.messageId)
                        .put("policyEnvelopeSha256", fields.policyEnvelopeSha256Base64Url)
                        .put("canonicalEnvelopeBytes", expectedEnvelopeCanonicalBase64Url)
                        .put("envelopeSignature", "opaque-signature").put("trustSetEpoch", 7).put("keyEpoch", 9)
                    else -> throw AssertionError("unexpected activation route: $path")
                }
                return response.toString().toByteArray(Charsets.UTF_8)
            }

            override fun postAuthenticated(path: String, body: ByteArray, bearerToken: String): ByteArray {
                assertEquals(sessionToken, bearerToken)
                return post(path, body)
            }
        }
        val signer = object : CurrentDeviceDskProofSigner {
            override fun signProof(fields: DevicePolicyApplicationProofV1.ProofFields, canonicalTranscript: ByteArray) =
                ByteArray(64).also { it[31] = 1; it[63] = 1 }
            override fun signBootstrapNonce(familyId: String, deviceId: String, nonceBase64Url: String) =
                ByteArray(64).also { it[31] = 1; it[63] = 1 }
        }
        var reachedGate = false
        val gate = DevicePolicyActivationReceiverGate { familyId, deviceId, target ->
            reachedGate = true
            assertEquals(fields.familyId, familyId)
            assertEquals(fields.deviceId, deviceId)
            assertArrayEquals(Base64.getUrlDecoder().decode(expectedEnvelopeCanonicalBase64Url), target.canonicalEnvelopeBytes)
            throw DevicePolicyActivationReceiverNotReadyException()
        }
        val bootstrap = DevicePolicyActivationBootstrap(DevicePolicyActivationApi(transport), signer, gate)

        assertThrows(DevicePolicyActivationReceiverNotReadyException::class.java) {
            bootstrap.fetchAndApply(fields.familyId, fields.deviceId)
        }
        assertTrue(reachedGate)
        assertEquals(listOf(
            "/v1/device-policy-activation/bootstrap/challenge",
            "/v1/device-policy-activation/bootstrap/complete",
            "/v1/device-policy-activation/bootstrap/fetch",
        ), paths)
    }
}
