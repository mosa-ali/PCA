package org.pca.app.firstdevice

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/**
 * Wave 6C: evidence-envelope tests. The packet is consumed by a STRICT
 * backend parser (exact member set, byte-recomputable challenge) and has a
 * hard 16 KiB budget enforced client-side BEFORE any network call.
 */
class AndroidKeyAttestationEvidenceTest {

    private val attemptId = "a".repeat(32)

    @Test
    fun `builds the exact strict envelope with unpadded base64url chain entries in order`() {
        val chain = listOf(ByteArray(300) { 1 }, ByteArray(200) { 2 })
        val evidence = AndroidKeyAttestationEvidence.build(attemptId, chain)
        val parsed = JSONObject(evidence)
        assertEquals(setOf("v", "platform", "attemptId", "chain"), parsed.keys().asSequence().toSet())
        assertEquals(1, parsed.getInt("v"))
        assertEquals("ANDROID", parsed.getString("platform"))
        assertEquals(attemptId, parsed.getString("attemptId"))
        val chainJson = parsed.getJSONArray("chain")
        assertEquals(2, chainJson.length())
        assertTrue(!chainJson.getString(0).contains('=') && !chainJson.getString(0).contains('+'))
        assertEquals(chain[0].toList(), java.util.Base64.getUrlDecoder().decode(chainJson.getString(0)).toList())
    }

    @Test
    fun `attemptId domain is enforced (16 to 64 base64url characters)`() {
        for (bad in listOf("", "short", "x".repeat(65), "has space".repeat(3), "bad+char".repeat(4))) {
            try {
                AndroidKeyAttestationEvidence.build(bad, listOf(byteArrayOf(1), byteArrayOf(2)))
                fail("attemptId must be rejected: '$bad'")
            } catch (_: IllegalArgumentException) { /* expected */ }
        }
    }

    @Test
    fun `chain size is bounded to 2 to 6 certificates and rejects empty entries`() {
        try {
            AndroidKeyAttestationEvidence.build(attemptId, listOf(byteArrayOf(1)))
            fail("single-cert chain must be rejected")
        } catch (_: IllegalArgumentException) { /* expected */ }
        try {
            AndroidKeyAttestationEvidence.build(attemptId, List(7) { byteArrayOf(1) })
            fail("seven-cert chain must be rejected")
        } catch (_: IllegalArgumentException) { /* expected */ }
        try {
            AndroidKeyAttestationEvidence.build(attemptId, listOf(byteArrayOf(1), ByteArray(0)))
            fail("empty certificate must be rejected")
        } catch (_: IllegalArgumentException) { /* expected */ }
    }

    @Test
    fun `an oversized chain fails closed above the certified 16 KiB budget`() {
        // 3 certs x 6000 bytes DER -> ~24000 base64 chars, far above 16384 bytes.
        val chain = List(3) { ByteArray(6000) { 7 } }
        try {
            AndroidKeyAttestationEvidence.build(attemptId, chain)
            fail("oversized evidence must be rejected before any network call")
        } catch (_: IllegalStateException) { /* expected */ }
    }

    @Test
    fun `a chain within the budget serializes to at most 16384 UTF-8 bytes`() {
        val chain = listOf(ByteArray(5000) { 1 }, ByteArray(4000) { 2 }, ByteArray(1000) { 3 })
        val evidence = AndroidKeyAttestationEvidence.build(attemptId, chain)
        assertTrue(evidence.toByteArray(Charsets.UTF_8).size <= AndroidKeyAttestationEvidence.MAX_EVIDENCE_BYTES)
    }
}
