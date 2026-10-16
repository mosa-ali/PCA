package org.pca.app.runtime.policyproof

import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import java.util.Base64
import org.json.JSONObject
import org.pca.app.runtime.trustset.StrictJsonMemberNames

data class DevicePolicyActivationCapability(
    val challenge: DevicePolicyApplicationProofV1.Challenge,
    val activationCapability: String,
    val familyId: String,
    val deviceId: String,
    val policyEnvelopeMessageId: String,
    val policyEnvelopeSha256Base64Url: String,
    val trustSetEpoch: Long,
    val keyEpoch: Long,
)

data class DevicePolicyActivationTarget(
    val challengeId: String,
    val policyEnvelopeMessageId: String,
    val policyEnvelopeSha256Base64Url: String,
    val canonicalEnvelopeBytes: ByteArray,
    val envelopeSignature: String,
    val trustSetEpoch: Long,
    val keyEpoch: Long,
)

data class DevicePolicyProofResponse(val outcome: String, val idempotent: Boolean)

fun interface DevicePolicyActivationHttpTransport {
    fun post(path: String, body: ByteArray): ByteArray
}

/** Device-scoped PAIRED bootstrap adapter. It never carries an ACTIVE bearer session. */
class DevicePolicyActivationApi(private val transport: DevicePolicyActivationHttpTransport) {
    fun challenge(familyId: String, deviceId: String): DevicePolicyApplicationProofV1.Challenge {
        validateIdentity(familyId, deviceId)
        val response = post("/v1/device-policy-activation/bootstrap/challenge", JSONObject()
            .put("familyId", familyId).put("deviceId", deviceId).toString().toByteArray(Charsets.UTF_8))
        return parseChallenge(response)
    }

    fun complete(
        familyId: String,
        deviceId: String,
        challenge: DevicePolicyApplicationProofV1.Challenge,
        signer: CurrentDeviceDskProofSigner,
    ): DevicePolicyActivationCapability {
        validateIdentity(familyId, deviceId)
        validateChallenge(challenge)
        val signature = signer.signBootstrapNonce(familyId, deviceId, challenge.nonceBase64Url)
        DevicePolicyApplicationProofV1.validateCanonicalSignature(signature)
        val body = JSONObject().put("familyId", familyId).put("deviceId", deviceId)
            .put("challengeId", challenge.challengeId).put("nonce", challenge.nonceBase64Url)
            .put("signature", DevicePolicyApplicationProofV1.encodeBase64Url(signature)).toString()
        val response = parseObject(post("/v1/device-policy-activation/bootstrap/complete", body.toByteArray(Charsets.UTF_8)))
        requireKeys(response, setOf("challengeId", "nonce", "expiresAt", "activationCapability", "policyEnvelopeMessageId", "policyEnvelopeSha256", "trustSetEpoch", "keyEpoch"))
        val returnedChallenge = DevicePolicyApplicationProofV1.Challenge(
            response.getString("challengeId"), response.getString("nonce"), response.getString("expiresAt"))
        validateChallenge(returnedChallenge)
        val capability = response.getString("activationCapability")
        DevicePolicyApplicationProofV1.decode32ByteBase64Url(capability)
        val messageId = response.getString("policyEnvelopeMessageId")
        require(messageId.isNotEmpty() && messageId.toByteArray(Charsets.UTF_8).size <= 512)
        val digest = response.getString("policyEnvelopeSha256")
        DevicePolicyApplicationProofV1.decode32ByteBase64Url(digest)
        val trust = strictLong(response, "trustSetEpoch").also { require(it in 1..Int.MAX_VALUE.toLong()) }
        val key = strictLong(response, "keyEpoch").also { require(it in 1..Int.MAX_VALUE.toLong()) }
        require(returnedChallenge == challenge)
        return DevicePolicyActivationCapability(returnedChallenge, capability, familyId, deviceId, messageId, digest, trust, key)
    }

    fun fetch(capability: DevicePolicyActivationCapability): DevicePolicyActivationTarget {
        val body = JSONObject().put("familyId", capability.familyId).put("deviceId", capability.deviceId)
            .put("activationCapability", capability.activationCapability).toString()
        val response = parseObject(post("/v1/device-policy-activation/bootstrap/fetch", body.toByteArray(Charsets.UTF_8)))
        requireKeys(response, setOf("challengeId", "policyEnvelopeMessageId", "policyEnvelopeSha256", "canonicalEnvelopeBytes", "envelopeSignature", "trustSetEpoch", "keyEpoch"))
        val encoded = response.getString("canonicalEnvelopeBytes")
        val bytes = decodeCanonicalBase64Url(encoded)
        require(bytes.isNotEmpty() && bytes.size <= DevicePolicyApplicationProofV1.MAX_ENVELOPE_CANONICAL_BYTES)
        val result = DevicePolicyActivationTarget(response.getString("challengeId"), response.getString("policyEnvelopeMessageId"),
            response.getString("policyEnvelopeSha256"), bytes, response.getString("envelopeSignature"),
            strictLong(response, "trustSetEpoch"), strictLong(response, "keyEpoch"))
        require(result.challengeId == capability.challenge.challengeId &&
            result.policyEnvelopeMessageId == capability.policyEnvelopeMessageId &&
            result.policyEnvelopeSha256Base64Url == capability.policyEnvelopeSha256Base64Url &&
            result.trustSetEpoch == capability.trustSetEpoch && result.keyEpoch == capability.keyEpoch)
        require(result.envelopeSignature.isNotEmpty() && result.envelopeSignature.toByteArray(Charsets.UTF_8).size <= 512)
        require(DevicePolicyApplicationProofV1.encodeBase64Url(java.security.MessageDigest.getInstance("SHA-256").digest(bytes)) == result.policyEnvelopeSha256Base64Url)
        DevicePolicyApplicationProofV1.requireCanonicalActivationTarget(
            bytes, capability.familyId, capability.deviceId, result.policyEnvelopeMessageId,
            result.trustSetEpoch, result.keyEpoch,
        )
        return result
    }

    fun submit(fields: DevicePolicyApplicationProofV1.ProofFields, signatureBase64Url: String): DevicePolicyProofResponse {
        val signature = decodeSignature(signatureBase64Url)
        DevicePolicyApplicationProofV1.canonicalTranscript(fields)
        val json = proofBody(fields, signatureBase64Url)
        return parseProofResponse(post("/v1/device-policy-activation/proof", json.toByteArray(Charsets.UTF_8)))
    }

    fun recover(challengeId: String, exactRequestSha256: String): DevicePolicyProofResponse {
        requireCanonicalUuidForApi(challengeId)
        DevicePolicyApplicationProofV1.decode32ByteBase64Url(exactRequestSha256)
        val body = JSONObject().put("challengeId", challengeId).put("exactRequestSha256", exactRequestSha256).toString()
        return parseProofResponse(post("/v1/device-policy-activation/proof/status", body.toByteArray(Charsets.UTF_8)))
    }

    private fun proofBody(fields: DevicePolicyApplicationProofV1.ProofFields, signature: String): String = JSONObject()
        .put("familyId", fields.familyId).put("deviceId", fields.deviceId)
        .put("policyEnvelopeMessageId", fields.policyEnvelopeMessageId)
        .put("policyEnvelopeSha256", fields.policyEnvelopeSha256Base64Url)
        .put("trustSetEpoch", fields.trustSetEpoch).put("keyEpoch", fields.keyEpoch)
        .put("applicationResult", fields.applicationResult.name)
        .put("challengeId", fields.challenge.challengeId).put("challengeNonce", fields.challenge.nonceBase64Url)
        .put("challengeExpiresAt", fields.challenge.expiresAt).put("signature", signature).toString()

    private fun parseProofResponse(bytes: ByteArray): DevicePolicyProofResponse {
        val json = parseObject(bytes)
        requireKeys(json, setOf("outcome", "idempotent"))
        val outcome = json.getString("outcome")
        require(outcome in setOf("ACTIVATED", "RECORDED_NOT_ACTIVATED"))
        return DevicePolicyProofResponse(outcome, json.getBoolean("idempotent"))
    }

    private fun parseChallenge(bytes: ByteArray): DevicePolicyApplicationProofV1.Challenge {
        val json = parseObject(bytes)
        requireKeys(json, setOf("challengeId", "nonce", "expiresAt"))
        return DevicePolicyApplicationProofV1.Challenge(json.getString("challengeId"), json.getString("nonce"), json.getString("expiresAt"))
            .also(::validateChallenge)
    }

    private fun validateChallenge(challenge: DevicePolicyApplicationProofV1.Challenge) {
        DevicePolicyApplicationProofV1.canonicalTranscript(
            DevicePolicyApplicationProofV1.ProofFields("00000000-0000-4000-8000-000000000000", "00000000-0000-4000-8000-000000000000",
                "x", DevicePolicyApplicationProofV1.encodeBase64Url(ByteArray(32)), 1, 1,
                DevicePolicyApplicationProofV1.ApplicationResult.DEGRADED, challenge))
        require(java.time.Instant.parse(challenge.expiresAt).isAfter(java.time.Instant.now()))
    }

    private fun validateIdentity(familyId: String, deviceId: String) {
        requireCanonicalUuidForApi(familyId); requireCanonicalUuidForApi(deviceId)
    }

    private fun decodeSignature(value: String): ByteArray {
        require(value.length == 86)
        val bytes = decodeCanonicalBase64Url(value)
        DevicePolicyApplicationProofV1.validateCanonicalSignature(bytes)
        return bytes
    }

    private fun decodeCanonicalBase64Url(value: String): ByteArray {
        require(value.isNotEmpty() && value.all { it in 'A'..'Z' || it in 'a'..'z' || it in '0'..'9' || it == '_' || it == '-' })
        val bytes = Base64.getUrlDecoder().decode(value)
        require(Base64.getUrlEncoder().withoutPadding().encodeToString(bytes) == value)
        return bytes
    }

    private fun post(path: String, body: ByteArray): ByteArray = transport.post(path, body).also { require(it.size <= MAX_RESPONSE_BYTES) }

    private fun parseObject(bytes: ByteArray): JSONObject {
        require(bytes.isNotEmpty() && bytes.size <= MAX_RESPONSE_BYTES)
        val text = Charsets.UTF_8.newDecoder().decode(java.nio.ByteBuffer.wrap(bytes)).toString()
        StrictJsonMemberNames.requireUnique(text)
        return JSONObject(text)
    }

    private fun strictLong(json: JSONObject, key: String): Long {
        val raw = json.get(key)
        require(raw is Int || raw is Long)
        return (raw as Number).toLong()
    }

    private fun requireKeys(json: JSONObject, keys: Set<String>) { require(json.keys().asSequence().toSet() == keys) }

    private companion object {
        const val MAX_RESPONSE_BYTES = 136 * 1024
        fun requireCanonicalUuidForApi(value: String) {
            require(value.length == 36 && value == value.lowercase() && java.util.UUID.fromString(value).toString() == value)
        }
    }
}

/** HTTPS-only production transport. Redirects and authenticated-session headers are deliberately absent. */
class UrlConnectionDevicePolicyActivationTransport(baseUrl: String) : DevicePolicyActivationHttpTransport {
    private val base: URI = URI.create(baseUrl).also {
        require(it.scheme.equals("https", true) && !it.host.isNullOrBlank() && it.userInfo == null &&
            it.query == null && it.fragment == null && (it.path.isEmpty() || it.path == "/"))
    }

    override fun post(path: String, body: ByteArray): ByteArray {
        require(path.startsWith("/v1/device-policy-activation/") && body.size <= 64 * 1024)
        val connection = URL(base.toString().trimEnd('/') + path).openConnection() as HttpURLConnection
        try {
            connection.instanceFollowRedirects = false
            connection.requestMethod = "POST"
            connection.connectTimeout = 15_000; connection.readTimeout = 15_000
            connection.setRequestProperty("Content-Type", "application/json")
            connection.doOutput = true
            connection.setFixedLengthStreamingMode(body.size)
            connection.outputStream.use { it.write(body) }
            require(connection.responseCode in 200..299) { "device_policy_activation_unavailable" }
            return connection.inputStream.use { input ->
                val out = java.io.ByteArrayOutputStream()
                val buffer = ByteArray(8192)
                while (true) {
                    val count = input.read(buffer); if (count < 0) break
                    require(out.size() + count <= 136 * 1024); out.write(buffer, 0, count)
                }
                out.toByteArray()
            }
        } finally { connection.disconnect() }
    }
}
