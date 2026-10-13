package org.pca.app.runtime.sync

import java.util.Base64
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Test
import org.pca.app.runtime.sync.envelope.FamilyEnvelope
import org.pca.app.runtime.sync.envelope.RecipientBinding
import org.pca.app.runtime.sync.envelope.envelopeFromRelayCiphertext
import org.pca.app.runtime.sync.envelope.envelopeToRelayCiphertext

private fun buildEnvelope(
    recipient: RecipientBinding = RecipientBinding.Device("recipient-1"),
    correlationId: String? = null,
    payload: ByteArray = "super secret ciphertext bytes".toByteArray(Charsets.UTF_8),
): FamilyEnvelope = FamilyEnvelope(
    protocolMajor = 1,
    protocolMinor = 0,
    messageId = "msg-1",
    familyId = "family-1",
    senderDeviceId = "device-1",
    recipient = recipient,
    senderKeyId = "key-1",
    messageType = "STATUS_SNAPSHOT",
    trustSetEpoch = 1,
    keyEpoch = 1,
    sequenceOrNonce = "nonce-1",
    issuedAtEpochMillis = 1_767_225_600_000L, // 2026-01-01T00:00:00.000Z
    expiresAtEpochMillis = 1_767_312_000_000L, // 2026-01-02T00:00:00.000Z
    semanticVersion = "1.0.0",
    correlationId = correlationId,
    payload = payload,
    signature = "sig-1",
)

class EnvelopeWireCodecTest {
    @Test
    fun `round-trips a DEVICE-recipient envelope unchanged`() {
        val envelope = buildEnvelope()
        val parsed = envelopeFromRelayCiphertext(envelopeToRelayCiphertext(envelope))
        assertEquals(envelope, parsed)
    }

    @Test
    fun `round-trips a GROUP-recipient envelope`() {
        val envelope = buildEnvelope(recipient = RecipientBinding.Group("all-parents"))
        val parsed = envelopeFromRelayCiphertext(envelopeToRelayCiphertext(envelope))
        assertEquals(envelope, parsed)
    }

    @Test
    fun `round-trips a correlationId`() {
        val envelope = buildEnvelope(correlationId = "child-request-msg-id")
        val parsed = envelopeFromRelayCiphertext(envelopeToRelayCiphertext(envelope))
        assertEquals("child-request-msg-id", parsed?.correlationId)
    }

    @Test
    fun `protocol version components round-trip through the JSON safe-integer maximum`() {
        val envelope = buildEnvelope().copy(
            protocolMajor = 9_007_199_254_740_991L,
            protocolMinor = 9_007_199_254_740_991L,
        )

        assertEquals(envelope, envelopeFromRelayCiphertext(envelopeToRelayCiphertext(envelope)))
    }

    @Test
    fun `never mutates payload bytes, including 0x00 and 0xff`() {
        val payload = byteArrayOf(0, 1, 2, -1, -2, -3, 10, 13)
        val envelope = buildEnvelope(payload = payload)
        val parsed = envelopeFromRelayCiphertext(envelopeToRelayCiphertext(envelope))
        assertEquals(true, parsed?.payload?.contentEquals(payload))
    }

    @Test
    fun `the issuedAt wire string matches JavaScript's toISOString format exactly`() {
        val envelope = buildEnvelope()
        val json = String(envelopeToRelayCiphertext(envelope), Charsets.UTF_8)
        assertEquals(true, json.contains("\"issuedAt\":\"2026-01-01T00:00:00.000Z\""))
    }

    @Test
    fun `malformed JSON is rejected as null, not thrown`() {
        assertNull(envelopeFromRelayCiphertext("not json at all".toByteArray()))
    }

    @Test
    fun `structurally invalid JSON is rejected as null`() {
        assertNull(envelopeFromRelayCiphertext("{\"foo\":\"bar\"}".toByteArray()))
    }

    @Test
    fun `epoch fields reject negative and above INT32_MAX values on decode`() {
        val encoded = String(envelopeToRelayCiphertext(buildEnvelope()), Charsets.UTF_8)
        for (field in listOf("trustSetEpoch", "keyEpoch")) {
            for (value in listOf("-1", "2147483648")) {
                val invalid = encoded.replace("\"$field\":1", "\"$field\":$value")
                assertNull("$field=$value", envelopeFromRelayCiphertext(invalid.toByteArray()))
            }
        }
    }

    @Test
    fun `epoch fields accept integral JSON decimal and exponent forms`() {
        val encoded = String(envelopeToRelayCiphertext(buildEnvelope()), Charsets.UTF_8)
            .replace("\"trustSetEpoch\":1", "\"trustSetEpoch\":1.0")
            .replace("\"keyEpoch\":1", "\"keyEpoch\":1e0")

        val parsed = envelopeFromRelayCiphertext(encoded.toByteArray())

        assertEquals(1L, parsed?.trustSetEpoch)
        assertEquals(1L, parsed?.keyEpoch)
    }

    @Test
    fun `wire decoder rejects noncanonical malformed and oversized base64 payloads`() {
        val encoded = String(
            envelopeToRelayCiphertext(buildEnvelope(payload = byteArrayOf('a'.code.toByte()))),
            Charsets.UTF_8,
        )
        for (payload in listOf("YQ\$=", "YR==", "YQ==junk")) {
            val malformed = encoded.replace("\"payload\":\"YQ==\"", "\"payload\":\"$payload\"")
            assertNull(payload, envelopeFromRelayCiphertext(malformed.toByteArray(Charsets.UTF_8)))
        }

        val oversizedPayload = Base64.getEncoder().encodeToString(ByteArray(65_537) { 1 })
        val oversizedWire = encoded.replace("\"payload\":\"YQ==\"", "\"payload\":\"$oversizedPayload\"")
        assertNull(envelopeFromRelayCiphertext(oversizedWire.toByteArray(Charsets.UTF_8)))
        assertThrows(IllegalArgumentException::class.java) {
            envelopeToRelayCiphertext(buildEnvelope(payload = ByteArray(65_537) { 1 }))
        }
    }

    @Test
    fun `wire decoder requires typed bounded metadata before constructing envelope`() {
        val encoded = String(envelopeToRelayCiphertext(buildEnvelope()), Charsets.UTF_8)
        val invalidFields = listOf(
            encoded.replace("\"messageId\":\"msg-1\"", "\"messageId\":1"),
            encoded.replace("\"protocolMinor\":0", "\"protocolMinor\":-1"),
            encoded.replace("\"semanticVersion\":\"1.0.0\"", "\"semanticVersion\":\"01.0.0\""),
            encoded.replace("\"messageType\":\"STATUS_SNAPSHOT\"", "\"messageType\":\"UNRECOGNIZED\""),
        )
        invalidFields.forEach { invalid ->
            assertNull(envelopeFromRelayCiphertext(invalid.toByteArray(Charsets.UTF_8)))
        }
    }

    @Test
    fun `protocol version decoder rejects negative fractional unsafe and string values`() {
        val encoded = String(envelopeToRelayCiphertext(buildEnvelope()), Charsets.UTF_8)
        val invalidValues = listOf("-1", "1.5", "9007199254740992", "1e1000000000", "\"1\"")

        for (field in listOf("protocolMajor", "protocolMinor")) {
            for (value in invalidValues) {
                val original = if (field == "protocolMajor") "\"protocolMajor\":1" else "\"protocolMinor\":0"
                val invalid = encoded.replace(original, "\"$field\":$value")
                assertNull("$field=$value", envelopeFromRelayCiphertext(invalid.toByteArray(Charsets.UTF_8)))
            }
        }
        assertNull(
            envelopeFromRelayCiphertext(encoded.replace("\"protocolMajor\":1", "\"protocolMajor\":0").toByteArray()),
        )
    }

    @Test
    fun `encoder and decoder enforce the complete 64 KiB relay wire boundary`() {
        val exactEnvelope = envelopeAtWireSize(64 * 1024)
        val exactWire = envelopeToRelayCiphertext(exactEnvelope)
        assertEquals(64 * 1024, exactWire.size)
        assertEquals(exactEnvelope, envelopeFromRelayCiphertext(exactWire))
        assertNull(envelopeFromRelayCiphertext(exactWire + byteArrayOf(' '.code.toByte())))
        assertThrows(IllegalArgumentException::class.java) {
            envelopeToRelayCiphertext(exactEnvelope.copy(signature = exactEnvelope.signature + "x"))
        }
    }

    @Test
    fun `wire decoder rejects malformed UTF-8`() {
        val encoded = envelopeToRelayCiphertext(buildEnvelope()) + byteArrayOf(0xC3.toByte())
        assertNull(envelopeFromRelayCiphertext(encoded))
    }

    @Test
    fun `wire decoder rejects duplicate JSON members and trailing data`() {
        val encoded = String(envelopeToRelayCiphertext(buildEnvelope()), Charsets.UTF_8)
        val duplicate = encoded.replace("{", "{\"messageId\":\"shadow\",")
        assertNull(envelopeFromRelayCiphertext(duplicate.toByteArray(Charsets.UTF_8)))
        assertNull(envelopeFromRelayCiphertext((encoded + " {} ").toByteArray(Charsets.UTF_8)))
    }

    @Test
    fun `encoder rejects invalid epoch fields`() {
        assertThrows(IllegalArgumentException::class.java) {
            envelopeToRelayCiphertext(buildEnvelope().copy(trustSetEpoch = Int.MAX_VALUE.toLong() + 1L))
        }
        assertThrows(IllegalArgumentException::class.java) {
            envelopeToRelayCiphertext(buildEnvelope().copy(keyEpoch = -1L))
        }
        assertThrows(IllegalArgumentException::class.java) {
            envelopeToRelayCiphertext(buildEnvelope().copy(protocolMajor = 0L))
        }
        assertThrows(IllegalArgumentException::class.java) {
            envelopeToRelayCiphertext(buildEnvelope().copy(protocolMinor = 9_007_199_254_740_992L))
        }
    }

    private fun envelopeAtWireSize(targetBytes: Int): FamilyEnvelope {
        val seed = buildEnvelope(payload = byteArrayOf(1), correlationId = null).copy(signature = "s")
        val seedWireSize = envelopeToRelayCiphertext(seed).size
        for (payloadSize in 1..(targetBytes * 3 / 4)) {
            val payloadBase64Length = ((payloadSize + 2) / 3) * 4
            val signatureLength = 1 + targetBytes - seedWireSize - (payloadBase64Length - 4)
            if (signatureLength in 1..512) {
                val candidate = seed.copy(
                    payload = ByteArray(payloadSize) { 1 },
                    signature = "s".repeat(signatureLength),
                )
                if (envelopeToRelayCiphertext(candidate).size == targetBytes) return candidate
            }
        }
        throw AssertionError("Could not construct an envelope of exactly $targetBytes bytes.")
    }
}
