package org.pca.app.runtime.sync

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
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
}
