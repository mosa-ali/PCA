package org.pca.app.runtime.sync.envelope

import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.Base64
import org.json.JSONException
import org.json.JSONObject
import org.pca.app.runtime.EpochBounds
import org.pca.app.runtime.trustset.StrictJsonMemberNames

/**
 * Runtime adapter around the SAME wire shape
 * backend/src/runtime-sync/envelopeWireCodec.ts serializes/parses (doc 40
 * Section 7) -- JSON with ISO-8601 date strings and base64 `payload`,
 * riding inside the Relay's opaque ciphertext transport. This module never
 * invents a new wire format and never inspects `payload` beyond
 * byte-copying it.
 *
 * ISO-8601 formatting MUST exactly match JavaScript's `Date#toISOString()`
 * (always exactly 3 fractional-second digits, `Z` suffix, no offset) --
 * the backend's own parser round-trip-checks `parsed.toISOString() ===
 * candidate` and rejects anything that doesn't match byte-for-byte, so an
 * envelope this device sends must be parseable by a backend-side receiver.
 */
private val ISO_FORMATTER: DateTimeFormatter =
    DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(ZoneOffset.UTC)

private fun formatIsoInstant(epochMillis: Long): String = ISO_FORMATTER.format(Instant.ofEpochMilli(epochMillis))

private fun parseIsoInstant(value: String): Long? {
    return try {
        val instant = Instant.parse(value)
        val epochMillis = instant.toEpochMilli()
        // Round-trip check, mirroring backend/src/familyenvelope/parse.ts's
        // parseIsoDate -- reject anything that wasn't ALREADY canonical
        // (e.g. missing milliseconds, a non-UTC offset) rather than
        // silently normalizing an ambiguous timestamp.
        if (formatIsoInstant(epochMillis) == value) epochMillis else null
    } catch (_: Exception) {
        null
    }
}

private fun decodeUtf8Strict(bytes: ByteArray): String? = try {
    Charsets.UTF_8.newDecoder()
        .onMalformedInput(CodingErrorAction.REPORT)
        .onUnmappableCharacter(CodingErrorAction.REPORT)
        .decode(ByteBuffer.wrap(bytes))
        .toString()
} catch (_: Exception) {
    null
}

private fun base64Encode(bytes: ByteArray): String {
    val alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
    val result = StringBuilder()
    var i = 0
    while (i < bytes.size) {
        val b0 = bytes[i].toInt() and 0xFF
        val hasB1 = i + 1 < bytes.size
        val b1 = if (hasB1) bytes[i + 1].toInt() and 0xFF else 0
        val hasB2 = i + 2 < bytes.size
        val b2 = if (hasB2) bytes[i + 2].toInt() and 0xFF else 0

        result.append(alphabet[b0 shr 2])
        result.append(alphabet[((b0 and 0x03) shl 4) or (b1 shr 4)])
        result.append(if (hasB1) alphabet[((b1 and 0x0f) shl 2) or (b2 shr 6)] else '=')
        result.append(if (hasB2) alphabet[b2 and 0x3f] else '=')
        i += 3
    }
    return result.toString()
}

private fun base64Decode(base64: String): ByteArray? {
    if (base64.isEmpty()) return null
    return try {
        Base64.getDecoder().decode(base64).takeIf { decoded ->
            decoded.size in 1..MAX_PAYLOAD_BYTES && base64Encode(decoded) == base64
        }
    } catch (_: IllegalArgumentException) {
        null
    }
}

fun envelopeToRelayCiphertext(envelope: FamilyEnvelope): ByteArray {
    ProtocolVersionBounds.requireMajor(envelope.protocolMajor)
    ProtocolVersionBounds.requireMinor(envelope.protocolMinor)
    EpochBounds.requireValid(envelope.trustSetEpoch, "trustSetEpoch")
    EpochBounds.requireValid(envelope.keyEpoch, "keyEpoch")
    val json = JSONObject()
    json.put("protocolMajor", envelope.protocolMajor)
    json.put("protocolMinor", envelope.protocolMinor)
    json.put("messageId", envelope.messageId)
    json.put("familyId", envelope.familyId)
    json.put("senderDeviceId", envelope.senderDeviceId)
    when (val recipient = envelope.recipient) {
        is RecipientBinding.Device -> json.put("recipientDeviceId", recipient.recipientDeviceId)
        is RecipientBinding.Group -> json.put("recipientGroup", recipient.recipientGroup)
    }
    json.put("senderKeyId", envelope.senderKeyId)
    json.put("messageType", envelope.messageType)
    json.put("trustSetEpoch", envelope.trustSetEpoch)
    json.put("keyEpoch", envelope.keyEpoch)
    json.put("sequenceOrNonce", envelope.sequenceOrNonce)
    json.put("issuedAt", formatIsoInstant(envelope.issuedAtEpochMillis))
    json.put("expiresAt", formatIsoInstant(envelope.expiresAtEpochMillis))
    json.put("semanticVersion", envelope.semanticVersion)
    json.put("correlationId", envelope.correlationId)
    json.put("payload", base64Encode(envelope.payload))
    json.put("signature", envelope.signature)
    val wire = json.toString().toByteArray(Charsets.UTF_8)
    require(wire.size <= MAX_WIRE_BYTES) { "Family envelope exceeds the relay wire size limit." }
    return wire
}

/** Returns null for anything structurally malformed -- same "no granular error, no probing oracle" posture as the backend parser. */
fun envelopeFromRelayCiphertext(ciphertext: ByteArray): FamilyEnvelope? {
    if (ciphertext.size > MAX_WIRE_BYTES) return null
    val source = decodeUtf8Strict(ciphertext) ?: return null
    try {
        StrictJsonMemberNames.requireUnique(source)
    } catch (_: Exception) {
        return null
    }
    val json = try {
        JSONObject(source)
    } catch (_: JSONException) {
        return null
    }

    return try {
        fun string(key: String): String = (json.get(key) as? String) ?: throw JSONException("invalid_envelope_field")
        fun boundedString(key: String, maximum: Int = MAX_OPAQUE_ID_LENGTH): String =
            string(key).also { require(it.isNotEmpty() && it.length <= maximum) }

        val protocolMajor = ProtocolVersionBounds.decodeMajor(json)
        val protocolMinor = ProtocolVersionBounds.decodeMinor(json)
        val messageId = boundedString("messageId", MAX_MESSAGE_ID_LENGTH)
        val familyId = boundedString("familyId")
        val senderDeviceId = boundedString("senderDeviceId")
        val senderKeyId = boundedString("senderKeyId")
        val messageType = boundedString("messageType", MAX_MESSAGE_TYPE_LENGTH)
        require(messageType in MESSAGE_TYPES)
        val sequenceOrNonce = boundedString("sequenceOrNonce", MAX_SEQUENCE_OR_NONCE_LENGTH)
        val semanticVersion = boundedString("semanticVersion", MAX_SEMANTIC_VERSION_LENGTH)
        require(SEMANTIC_VERSION.matches(semanticVersion))
        val signature = boundedString("signature", MAX_SIGNATURE_LENGTH)

        val hasDevice = json.has("recipientDeviceId") && !json.isNull("recipientDeviceId")
        val hasGroup = json.has("recipientGroup") && !json.isNull("recipientGroup")
        if (hasDevice == hasGroup) return null
        val recipient = if (hasDevice) {
            RecipientBinding.Device(boundedString("recipientDeviceId"))
        } else {
            RecipientBinding.Group(boundedString("recipientGroup"))
        }

        val issuedAt = parseIsoInstant(string("issuedAt")) ?: return null
        val expiresAt = parseIsoInstant(string("expiresAt")) ?: return null
        if (expiresAt <= issuedAt) return null

        val correlationId = if (!json.has("correlationId") || json.isNull("correlationId")) {
            null
        } else {
            boundedString("correlationId", MAX_CORRELATION_ID_LENGTH)
        }
        val payload = base64Decode(string("payload")) ?: return null

        val trustSetEpoch = EpochBounds.decodeJson(json, "trustSetEpoch").toLong()
        val keyEpoch = EpochBounds.decodeJson(json, "keyEpoch").toLong()
        FamilyEnvelope(
            protocolMajor = protocolMajor,
            protocolMinor = protocolMinor,
            messageId = messageId,
            familyId = familyId,
            senderDeviceId = senderDeviceId,
            recipient = recipient,
            senderKeyId = senderKeyId,
            messageType = messageType,
            trustSetEpoch = trustSetEpoch,
            keyEpoch = keyEpoch,
            sequenceOrNonce = sequenceOrNonce,
            issuedAtEpochMillis = issuedAt,
            expiresAtEpochMillis = expiresAt,
            semanticVersion = semanticVersion,
            correlationId = correlationId,
            payload = payload,
            signature = signature,
        )
    } catch (_: Exception) {
        null
    }
}

private const val MAX_WIRE_BYTES = 64 * 1024
private const val MAX_OPAQUE_ID_LENGTH = 128
private const val MAX_MESSAGE_ID_LENGTH = 128
private const val MAX_CORRELATION_ID_LENGTH = 128
private const val MAX_SEQUENCE_OR_NONCE_LENGTH = 128
private const val MAX_SIGNATURE_LENGTH = 512
private const val MAX_SEMANTIC_VERSION_LENGTH = 32
private const val MAX_MESSAGE_TYPE_LENGTH = 64
private const val MAX_PAYLOAD_BYTES = 64 * 1024
private val SEMANTIC_VERSION = Regex("(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)")
private val MESSAGE_TYPES = setOf(
    "POLICY_UPDATE", "POLICY_RECEIPT", "STATUS_SNAPSHOT", "ACTIVITY_SUMMARY", "LOCATION_RESPONSE",
    "CHILD_REQUEST", "PARENT_DECISION", "TAMPER_ALERT", "RETENTION_DELETION_INSTRUCTION",
    "RETENTION_RECEIPT", "FTS_UPDATE", "KEY_ROTATION", "DEVICE_REVOKE", "RECOVERY_TRANSACTION", "SIGNED_ROLLBACK",
)
