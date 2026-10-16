package org.pca.app.runtime.policyproof

import java.nio.charset.CodingErrorAction
import java.security.MessageDigest
import java.math.BigInteger
import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.Base64
import java.util.UUID
import org.pca.app.runtime.sync.envelope.FamilyEnvelope
import org.pca.app.runtime.sync.envelope.RecipientBinding
import org.pca.app.security.DskSignatureEngine

/** Pure V1 encoding shared by activation-proof signing and cross-platform vectors. */
object DevicePolicyApplicationProofV1 {
    const val DOMAIN = "PCA_DEVICE_POLICY_APPLICATION_PROOF_V1"
    const val MAX_ENVELOPE_CANONICAL_BYTES = 98_304
    const val MAX_TRANSCRIPT_BYTES = 2_048
    const val MAX_ENCRYPTED_PAYLOAD_BYTES = 65_536

    private val canonicalTimestamp = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'")
        .withZone(ZoneOffset.UTC)
    private val base64Url = Base64.getUrlEncoder().withoutPadding()
    private val base64UrlDecoder = Base64.getUrlDecoder()
    private val base64 = Base64.getEncoder()

    enum class ApplicationResult { APPLIED, DEGRADED, REJECTED }

    data class Challenge(
        val challengeId: String,
        val nonceBase64Url: String,
        val expiresAt: String,
    )

    data class ProofFields(
        val familyId: String,
        val deviceId: String,
        val policyEnvelopeMessageId: String,
        val policyEnvelopeSha256Base64Url: String,
        val trustSetEpoch: Long,
        val keyEpoch: Long,
        val applicationResult: ApplicationResult,
        val challenge: Challenge,
    )

    data class SignedProof(
        val fields: ProofFields,
        val signatureBase64Url: String,
        val canonicalTranscriptSha256Base64Url: String,
    )

    /** Exact UTF-8 signed fields from backend canonicalizeEnvelope, excluding signature. */
    fun canonicalEnvelopeBytes(envelope: FamilyEnvelope): ByteArray {
        require(envelope.payload.size <= MAX_ENCRYPTED_PAYLOAD_BYTES) { "Envelope payload exceeds V1 limit" }
        val (recipientKind, recipientValue) = when (val recipient = envelope.recipient) {
            is RecipientBinding.Device -> "DEVICE" to recipient.recipientDeviceId
            is RecipientBinding.Group -> "GROUP" to recipient.recipientGroup
        }
        val fields = listOf(
            envelope.protocolMajor.toString(),
            envelope.protocolMinor.toString(),
            envelope.messageId,
            envelope.familyId,
            envelope.senderDeviceId,
            recipientKind,
            recipientValue,
            envelope.senderKeyId,
            envelope.messageType,
            envelope.sequenceOrNonce,
            canonicalTimestamp.format(Instant.ofEpochMilli(envelope.issuedAtEpochMillis)),
            canonicalTimestamp.format(Instant.ofEpochMilli(envelope.expiresAtEpochMillis)),
            envelope.trustSetEpoch.toString(),
            envelope.keyEpoch.toString(),
            envelope.semanticVersion,
            if (envelope.correlationId != null) "1" else "0",
            envelope.correlationId ?: "",
            base64.encodeToString(envelope.payload),
        )
        val transcript = netstrings(fields)
        require(transcript.size <= MAX_ENVELOPE_CANONICAL_BYTES) { "Envelope canonical bytes exceed V1 limit" }
        return transcript
    }

    /** Reject a digest input unless it is the current device's activation policy target. */
    fun requireActivationTargetEnvelope(envelope: FamilyEnvelope, familyId: String, deviceId: String) {
        require(envelope.messageType == "POLICY_UPDATE") { "Activation target must be POLICY_UPDATE" }
        require(envelope.familyId == familyId) { "Activation target family mismatch" }
        val recipient = envelope.recipient as? RecipientBinding.Device
            ?: throw IllegalArgumentException("Activation target must be device-addressed")
        require(recipient.recipientDeviceId == deviceId) { "Activation target device mismatch" }
        require(envelope.payload.size <= MAX_ENCRYPTED_PAYLOAD_BYTES) { "Envelope payload exceeds V1 limit" }
    }

    fun envelopeSha256(envelope: FamilyEnvelope): ByteArray =
        MessageDigest.getInstance("SHA-256").digest(canonicalEnvelopeBytes(envelope))

    fun envelopeSha256Base64Url(envelope: FamilyEnvelope): String =
        base64Url.encodeToString(envelopeSha256(envelope))

    /** Validates the server-returned canonical signed-field bytes without reconstructing an envelope. */
    fun requireCanonicalActivationTarget(
        bytes: ByteArray,
        familyId: String,
        deviceId: String,
        messageId: String,
        trustSetEpoch: Long,
        keyEpoch: Long,
    ) {
        require(bytes.isNotEmpty() && bytes.size <= MAX_ENVELOPE_CANONICAL_BYTES)
        val fields = parseNetstrings(bytes, expectedCount = 18)
        require(fields[2] == messageId && fields[3] == familyId)
        require(fields[5] == "DEVICE" && fields[6] == deviceId && fields[8] == "POLICY_UPDATE")
        require(fields[12] == trustSetEpoch.toString() && fields[13] == keyEpoch.toString())
        require(fields[17].let { encoded ->
            val payload = Base64.getDecoder().decode(encoded)
            payload.size <= MAX_ENCRYPTED_PAYLOAD_BYTES && base64.encodeToString(payload) == encoded
        })
    }

    /** Exact ordered proof transcript. The caller signs these UTF-8 bytes using SHA-256/ECDSA. */
    fun canonicalTranscript(fields: ProofFields): ByteArray {
        validate(fields)
        val transcript = netstrings(
            listOf(
                DOMAIN,
                fields.familyId,
                fields.deviceId,
                fields.policyEnvelopeMessageId,
                fields.policyEnvelopeSha256Base64Url,
                fields.trustSetEpoch.toString(),
                fields.keyEpoch.toString(),
                fields.applicationResult.name,
                fields.challenge.challengeId,
                fields.challenge.nonceBase64Url,
                fields.challenge.expiresAt,
            ),
        )
        require(transcript.size <= MAX_TRANSCRIPT_BYTES) { "Proof transcript exceeds V1 limit" }
        return transcript
    }

    fun transcriptSha256(fields: ProofFields): ByteArray =
        MessageDigest.getInstance("SHA-256").digest(canonicalTranscript(fields))

    /** Signs only through a custody-checked current-device DSK binding. */
    fun sign(fields: ProofFields, signer: CurrentDeviceDskProofSigner): SignedProof {
        require(fields.applicationResult != ApplicationResult.APPLIED) {
            "APPLIED signing is unavailable until the production verified-persisted-enforced receiver is wired"
        }
        val transcript = canonicalTranscript(fields)
        val signature = signer.signProof(fields, transcript)
        requireCanonicalLowSP1363(signature)
        return SignedProof(
            fields = fields,
            signatureBase64Url = base64Url.encodeToString(signature),
            canonicalTranscriptSha256Base64Url = base64Url.encodeToString(
                MessageDigest.getInstance("SHA-256").digest(transcript),
            ),
        )
    }

    fun encodeBase64Url(bytes: ByteArray): String = base64Url.encodeToString(bytes)

    fun validateCanonicalSignature(signature: ByteArray) = requireCanonicalLowSP1363(signature)

    /** Strict canonical unpadded base64url decoder for 32-byte V1 values. */
    fun decode32ByteBase64Url(value: String): ByteArray {
        require(value.length == 43 && value.all(::isBase64UrlCharacter)) { "Invalid V1 base64url value" }
        val decoded = base64UrlDecoder.decode(value)
        require(decoded.size == 32 && base64Url.encodeToString(decoded) == value) { "Noncanonical V1 base64url value" }
        return decoded
    }

    private fun validate(fields: ProofFields) {
        requireCanonicalUuid(fields.familyId)
        requireCanonicalUuid(fields.deviceId)
        require(fields.policyEnvelopeMessageId.isNotEmpty())
        require(fields.policyEnvelopeMessageId.length <= 128)
        require(fields.policyEnvelopeMessageId.toByteArray(Charsets.UTF_8).size <= 512)
        requireStrictUtf8(fields.policyEnvelopeMessageId)
        decode32ByteBase64Url(fields.policyEnvelopeSha256Base64Url)
        require(fields.trustSetEpoch in 1..Int.MAX_VALUE.toLong())
        require(fields.keyEpoch in 1..Int.MAX_VALUE.toLong())
        requireCanonicalUuid(fields.challenge.challengeId)
        decode32ByteBase64Url(fields.challenge.nonceBase64Url)
        requireCanonicalTimestamp(fields.challenge.expiresAt)
    }

    private fun requireCanonicalUuid(value: String) {
        require(value.length == 36 && value == value.lowercase())
        require(UUID.fromString(value).toString() == value)
    }

    private fun requireCanonicalTimestamp(value: String) {
        require(value.length == 24)
        val parsed = Instant.parse(value)
        require(canonicalTimestamp.format(parsed) == value)
    }

    private fun requireStrictUtf8(value: String) {
        strictUtf8Bytes(value)
    }

    private fun strictUtf8Bytes(value: String): ByteArray {
        val encoder = Charsets.UTF_8.newEncoder()
            .onMalformedInput(CodingErrorAction.REPORT)
            .onUnmappableCharacter(CodingErrorAction.REPORT)
        val buffer = encoder.encode(java.nio.CharBuffer.wrap(value))
        val bytes = ByteArray(buffer.remaining())
        buffer.get(bytes)
        return bytes
    }

    private fun isBase64UrlCharacter(char: Char): Boolean =
        char in 'A'..'Z' || char in 'a'..'z' || char in '0'..'9' || char == '_' || char == '-'

    private fun requireCanonicalLowSP1363(signature: ByteArray) {
        require(signature.size == 64) { "DSK signature must be IEEE-P1363 P-256" }
        val r = BigInteger(1, signature.copyOfRange(0, 32))
        val s = BigInteger(1, signature.copyOfRange(32, 64))
        require(r.signum() > 0 && r < p256Order && s.signum() > 0 && s <= p256HalfOrder) {
            "DSK signature is out of range or not canonical low-S"
        }
    }

    private fun netstrings(fields: List<String>): ByteArray {
        val output = java.io.ByteArrayOutputStream()
        fields.forEach { field ->
            val bytes = strictUtf8Bytes(field)
            output.write(bytes.size.toString().toByteArray(Charsets.US_ASCII))
            output.write(':'.code)
            output.write(bytes)
        }
        return output.toByteArray()
    }

    private fun parseNetstrings(bytes: ByteArray, expectedCount: Int): List<String> {
        var cursor = 0
        val result = ArrayList<String>(expectedCount)
        repeat(expectedCount) {
            val start = cursor
            while (cursor < bytes.size && (bytes[cursor].toInt() and 0xff) in 48..57) cursor++
            require(cursor > start && cursor < bytes.size && bytes[cursor] == ':'.code.toByte())
            val lengthText = String(bytes, start, cursor - start, Charsets.US_ASCII)
            require(lengthText == "0" || !lengthText.startsWith('0'))
            val length = lengthText.toIntOrNull() ?: throw IllegalArgumentException("Invalid canonical field length")
            cursor++
            require(length >= 0 && length <= bytes.size - cursor)
            result += strictUtf8String(bytes.copyOfRange(cursor, cursor + length))
            cursor += length
        }
        require(cursor == bytes.size)
        return result
    }

    private fun strictUtf8String(bytes: ByteArray): String = Charsets.UTF_8.newDecoder()
        .onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT)
        .decode(java.nio.ByteBuffer.wrap(bytes)).toString()

    private val p256Order = BigInteger("FFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551", 16)
    private val p256HalfOrder = p256Order.shiftRight(1)
}
