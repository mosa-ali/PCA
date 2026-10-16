package org.pca.app.runtime.policyproof

import java.math.BigInteger
import java.util.Base64
import java.time.Instant
import org.pca.app.foundation.InMemoryPersistentStateStore
import org.json.JSONObject
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import org.pca.app.runtime.sync.envelope.FamilyEnvelope
import org.pca.app.runtime.sync.envelope.RecipientBinding
import org.pca.app.runtime.schedule.locateSharedVectorFile
import org.pca.app.runtime.trustset.P256OrdinaryEpochVerifier

class DevicePolicyApplicationProofV1Test {
    private val sharedVector by lazy {
        val file = locateSharedVectorFile("shared/test-vectors/device-policy-application-proof-v1.json")
        assertTrue("could not locate device-policy-application-proof-v1.json", file != null)
        JSONObject(file!!.readText())
    }

    private val expectedEnvelopeCanonicalBase64Url: String
        get() = sharedVector.getJSONObject("canonicalEnvelope").getString("bytesBase64Url")

    private val envelope by lazy {
        val vector = sharedVector.getJSONObject("canonicalEnvelope").getJSONObject("envelopeFields")
        FamilyEnvelope(
            protocolMajor = vector.getLong("protocolMajor"),
            protocolMinor = vector.getLong("protocolMinor"),
            messageId = vector.getString("messageId"),
            familyId = vector.getString("familyId"),
            senderDeviceId = vector.getString("senderDeviceId"),
            recipient = when (vector.getString("recipientKind")) {
                "DEVICE" -> RecipientBinding.Device(vector.getString("recipientDeviceId"))
                else -> throw AssertionError("unexpected shared vector recipient kind")
            },
            senderKeyId = vector.getString("senderKeyId"),
            messageType = vector.getString("messageType"),
            trustSetEpoch = vector.getLong("trustSetEpoch"),
            keyEpoch = vector.getLong("keyEpoch"),
            sequenceOrNonce = vector.getString("sequenceOrNonce"),
            issuedAtEpochMillis = Instant.parse(vector.getString("issuedAt")).toEpochMilli(),
            expiresAtEpochMillis = Instant.parse(vector.getString("expiresAt")).toEpochMilli(),
            semanticVersion = vector.getString("semanticVersion"),
            correlationId = if (vector.isNull("correlationId")) null else vector.getString("correlationId"),
            payload = Base64.getDecoder().decode(vector.getString("encryptedPayloadBase64")),
            signature = "fixture-signature-not-used-for-canonicalization",
        )
    }

    private val fields by lazy {
        val vector = sharedVector.getJSONObject("validProof").getJSONObject("fields")
        DevicePolicyApplicationProofV1.ProofFields(
            familyId = vector.getString("familyId"),
            deviceId = vector.getString("deviceId"),
            policyEnvelopeMessageId = vector.getString("policyEnvelopeMessageId"),
            policyEnvelopeSha256Base64Url = vector.getString("policyEnvelopeSha256"),
            trustSetEpoch = vector.getLong("trustSetEpoch"),
            keyEpoch = vector.getLong("keyEpoch"),
            applicationResult = DevicePolicyApplicationProofV1.ApplicationResult.valueOf(vector.getString("applicationResult")),
            challenge = DevicePolicyApplicationProofV1.Challenge(
                challengeId = vector.getString("challengeId"),
                nonceBase64Url = vector.getString("challengeNonce"),
                expiresAt = vector.getString("challengeExpiresAt"),
            ),
        )
    }

    @Test
    fun canonicalEnvelopeAndDigestMatchFrozenBackendVector() {
        val canonical = DevicePolicyApplicationProofV1.canonicalEnvelopeBytes(envelope)
        val vector = sharedVector.getJSONObject("canonicalEnvelope")
        assertArrayEquals(Base64.getUrlDecoder().decode(vector.getString("bytesBase64Url")), canonical)
        assertEquals(vector.getString("bytesBase64Url"), Base64.getUrlEncoder().withoutPadding().encodeToString(canonical))
        assertEquals(vector.getString("sha256Base64Url"), DevicePolicyApplicationProofV1.envelopeSha256Base64Url(envelope))
        assertEquals(vector.getString("sha256Hex"), DevicePolicyApplicationProofV1.envelopeSha256(envelope).joinToString("") { "%02x".format(it) })
    }

    @Test
    fun proofTranscriptMatchesFrozenVector() {
        val canonical = DevicePolicyApplicationProofV1.canonicalTranscript(fields)
        val vector = sharedVector.getJSONObject("validProof")
        assertEquals(DevicePolicyApplicationProofV1.DOMAIN, vector.getJSONObject("fields").getString("domain"))
        assertArrayEquals(Base64.getUrlDecoder().decode(vector.getString("transcriptBase64Url")), canonical)
        assertEquals(vector.getString("transcriptBase64Url"), DevicePolicyApplicationProofV1.encodeBase64Url(canonical))
    }

    @Test
    fun sharedSyntheticVectorSignatureIsCanonicalLowSP1363() {
        val proofVector = sharedVector.getJSONObject("validProof")
        val expectedVectorSignatureBase64Url = proofVector.getString("signatureBase64Url")
        val signature = Base64.getUrlDecoder().decode(expectedVectorSignatureBase64Url)
        DevicePolicyApplicationProofV1.validateCanonicalSignature(
            signature,
        )
        assertEquals(64, signature.size)
        assertEquals(expectedVectorSignatureBase64Url, Base64.getUrlEncoder().withoutPadding().encodeToString(signature))

        val transcript = DevicePolicyApplicationProofV1.canonicalTranscript(fields)
        val publicKey = proofVector.getString("syntheticDskPublicKeySec1Base64Url")
        val verifier = P256OrdinaryEpochVerifier()
        val standardBase64Signature = Base64.getEncoder().encodeToString(signature)
        assertEquals(88, standardBase64Signature.length)
        assertTrue(verifier.verify(publicKey, transcript, standardBase64Signature))

        val changedTranscript = transcript.copyOf().also { it[it.lastIndex] = (it.last().toInt() xor 1).toByte() }
        assertTrue(verifier.verify(publicKey, changedTranscript, standardBase64Signature).not())
        val changedSignature = signature.copyOf().also { it[31] = (it[31].toInt() xor 1).toByte() }
        DevicePolicyApplicationProofV1.validateCanonicalSignature(changedSignature)
        assertTrue(verifier.verify(publicKey, transcript, Base64.getEncoder().encodeToString(changedSignature)).not())
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
