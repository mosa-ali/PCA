package org.pca.app.runtime.sync.envelope

import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import org.json.JSONException
import org.json.JSONObject

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

private fun base64Decode(base64: String): ByteArray {
    val alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
    val clean = base64.trimEnd('=')
    val bytes = ArrayList<Byte>()
    var buffer = 0
    var bitsCollected = 0
    for (char in clean) {
        val value = alphabet.indexOf(char)
        if (value == -1) continue
        buffer = (buffer shl 6) or value
        bitsCollected += 6
        if (bitsCollected >= 8) {
            bitsCollected -= 8
            bytes.add(((buffer shr bitsCollected) and 0xff).toByte())
        }
    }
    return bytes.toByteArray()
}

fun envelopeToRelayCiphertext(envelope: FamilyEnvelope): ByteArray {
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
    return json.toString().toByteArray(Charsets.UTF_8)
}

/** Returns null for anything structurally malformed -- same "no granular error, no probing oracle" posture as the backend parser. */
fun envelopeFromRelayCiphertext(ciphertext: ByteArray): FamilyEnvelope? {
    val json = try {
        JSONObject(String(ciphertext, Charsets.UTF_8))
    } catch (_: JSONException) {
        return null
    }

    return try {
        val hasDevice = json.has("recipientDeviceId") && !json.isNull("recipientDeviceId")
        val hasGroup = json.has("recipientGroup") && !json.isNull("recipientGroup")
        if (hasDevice == hasGroup) return null
        val recipient = if (hasDevice) {
            RecipientBinding.Device(json.getString("recipientDeviceId"))
        } else {
            RecipientBinding.Group(json.getString("recipientGroup"))
        }

        val issuedAt = parseIsoInstant(json.getString("issuedAt")) ?: return null
        val expiresAt = parseIsoInstant(json.getString("expiresAt")) ?: return null
        if (expiresAt <= issuedAt) return null

        val payload = base64Decode(json.getString("payload"))
        if (payload.isEmpty()) return null

        FamilyEnvelope(
            protocolMajor = json.getInt("protocolMajor"),
            protocolMinor = json.getInt("protocolMinor"),
            messageId = json.getString("messageId"),
            familyId = json.getString("familyId"),
            senderDeviceId = json.getString("senderDeviceId"),
            recipient = recipient,
            senderKeyId = json.getString("senderKeyId"),
            messageType = json.getString("messageType"),
            trustSetEpoch = json.getLong("trustSetEpoch"),
            keyEpoch = json.getLong("keyEpoch"),
            sequenceOrNonce = json.getString("sequenceOrNonce"),
            issuedAtEpochMillis = issuedAt,
            expiresAtEpochMillis = expiresAt,
            semanticVersion = json.getString("semanticVersion"),
            correlationId = if (json.isNull("correlationId")) null else json.getString("correlationId"),
            payload = payload,
            signature = json.getString("signature"),
        )
    } catch (_: JSONException) {
        null
    }
}
