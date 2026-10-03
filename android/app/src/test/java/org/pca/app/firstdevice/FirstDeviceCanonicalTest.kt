package org.pca.app.firstdevice

import java.io.File
import java.security.KeyPairGenerator
import java.security.spec.ECGenParameterSpec
import java.security.interfaces.ECPublicKey
import java.util.Base64
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.pca.app.security.AndroidKeystoreDskProvider

/**
 * Wave 6C: byte-exact canonical encoding tests for the Android ceremony
 * encoders, including the SHARED cross-language golden vectors pinned by the
 * certified backend suite (contracts/first-device-bootstrap/canonical-vectors.json).
 * Any drift between these Kotlin encoders and the backend canonicalizers is
 * an acceptance rejection in production, so it must fail HERE first.
 */
class FirstDeviceCanonicalTest {

    private fun locateVectors(): File {
        val candidates = listOf(
            File("../../contracts/first-device-bootstrap/canonical-vectors.json"),
            File("../contracts/first-device-bootstrap/canonical-vectors.json"),
            File("contracts/first-device-bootstrap/canonical-vectors.json"),
        )
        return candidates.firstOrNull { it.exists() }
            ?: error("canonical-vectors.json not found from ${File(".").absolutePath}")
    }

    @Test
    fun `challenge derivation matches the shared golden vector and the provider constant`() {
        val vectors = JSONObject(locateVectors().readText())
        val attemptId = vectors.getJSONObject("challengeExample").getString("attemptId")
        val expected = vectors.getJSONObject("challengeExample").getString("challengeBytesBase64Url")
        assertEquals(expected, FirstDeviceCanonical.base64Url(FirstDeviceCanonical.challengeBytes(attemptId)))
        assertEquals(FirstDeviceCanonical.ATTESTATION_CHALLENGE_PREFIX, AndroidKeystoreDskProvider.ATTESTATION_CHALLENGE_PREFIX)
    }

    @Test
    fun `proof encoding matches the shared golden vector byte for byte (and its sha256)`() {
        val vectors = JSONObject(locateVectors().readText())
        val input = vectors.getJSONObject("proofInput")
        val encoded = FirstDeviceCanonical.encodeProof(
            familyId = input.getString("familyId"),
            deviceId = input.getString("deviceId"),
            ceremonyId = input.getString("ceremonyId"),
            challengeId = input.getString("challengeId"),
            nonce = input.getString("nonce"),
            expiresAt = input.getString("expiresAtIso"),
            dskKeyId = input.getString("dskKeyId"),
            dskPublicKeyBase64 = input.getString("dskPublicKeyBase64"),
            epoch1Sha256Hex = input.getString("epoch1Sha256Hex"),
            attestationEvidenceDigest = input.getString("attestationEvidenceDigest"),
        )
        assertEquals(vectors.getString("proofCanonicalBytes"), encoded)
        assertEquals(vectors.getString("proofCanonicalSha256Hex"), FirstDeviceCanonical.sha256Hex(encoded))
        // Domain-led 13-field netstring: the domain prefix is the 29-byte
        // literal, NOT the 36-byte commit domain (a classic copy-paste trap).
        assertTrue(encoded.startsWith("29:${FirstDeviceCanonical.PROOF_DOMAIN}"))
        assertTrue(encoded.contains("13:null") || encoded.contains("64:"))
    }

    @Test
    fun `epoch-1 encoding matches the shared golden vector byte for byte (and its sha256)`() {
        val vectors = JSONObject(locateVectors().readText())
        val input = vectors.getJSONObject("epoch1Input")
        val encoded = FirstDeviceCanonical.encodeEpoch1(
            familyId = input.getString("familyId"),
            deviceId = input.getString("deviceId"),
            dskKeyId = input.getString("dskKeyId"),
            dskPublicKeyBase64 = input.getString("dskPublicKeyBase64"),
            dekKeyId = input.getString("dekKeyId"),
            dekPublicKeyBase64 = input.getString("dekPublicKeyBase64"),
            issuedAtIso = input.getString("issuedAtIso"),
        )
        assertEquals(vectors.getString("epoch1CanonicalBytes"), encoded)
        assertEquals(vectors.getString("epoch1CanonicalSha256Hex"), FirstDeviceCanonical.sha256Hex(encoded))
        // 6 + 7*1 fields; OWNER/ACTIVE vocabulary; literal null supersedes marker.
        assertTrue(encoded.contains("5:OWNER"))
        assertTrue(encoded.contains("6:ACTIVE"))
        assertTrue(encoded.endsWith("4:null"))
    }

    @Test
    fun `proof and epoch-1 bytes are structurally distinct for identical ceremony values (cross-protocol separation)`() {
        val vectors = JSONObject(locateVectors().readText())
        assertNotEquals(vectors.getString("proofCanonicalBytes"), vectors.getString("epoch1CanonicalBytes"))
    }

    @Test
    fun `isoUtcMillis always emits exactly three fractional digits and a literal Z (including ms=0)`() {
        assertEquals("2026-10-02T00:00:00.000Z", FirstDeviceCanonical.isoUtcMillis(java.util.Date(0).let { java.util.Date(1790899200000L) }))
        assertEquals("2026-10-02T00:00:00.123Z", FirstDeviceCanonical.isoUtcMillis(java.util.Date(1790899200123L)))
        assertEquals("2026-10-02T00:00:00.999Z", FirstDeviceCanonical.isoUtcMillis(java.util.Date(1790899200999L)))
        // Sub-millisecond fraction is truncated, never rounded into 4 digits.
        assertEquals("2026-10-02T00:00:00.000Z", FirstDeviceCanonical.isoUtcMillis(java.util.Date(1790899199999L + 1)))
    }

    @Test
    fun `base64Url is unpadded and url safe`() {
        val bytes = ByteArray(65) { (it + 250).toByte() }
        val encoded = FirstDeviceCanonical.base64Url(bytes)
        assertTrue(!encoded.contains('=') && !encoded.contains('+') && !encoded.contains('/'))
        assertTrue(bytes.contentEquals(Base64.getUrlDecoder().decode(encoded)))
    }

    @Test
    fun `canonical SEC1 public key is exactly 65 bytes 0x04-prefixed, unpadded base64url`() {
        val generator = KeyPairGenerator.getInstance("EC")
        generator.initialize(ECGenParameterSpec("secp256r1"))
        val publicKey = generator.generateKeyPair().public as ECPublicKey
        val encoded = FirstDeviceCanonical.canonicalPublicKeyBase64(publicKey)
        val decoded = Base64.getUrlDecoder().decode(encoded)
        assertEquals(65, decoded.size)
        assertEquals(0x04.toByte(), decoded[0])
        assertTrue(!encoded.contains('='))
        assertEquals(encoded, FirstDeviceCanonical.base64Url(decoded))
    }
}
