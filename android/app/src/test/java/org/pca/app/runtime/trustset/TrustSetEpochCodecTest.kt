package org.pca.app.runtime.trustset

import java.io.File
import java.security.MessageDigest
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class TrustSetEpochCodecTest {
    private fun fixtures(): JSONObject {
        val candidates = listOf(File("../../contracts/family-trust-set/canonical-vectors.json"),
            File("../contracts/family-trust-set/canonical-vectors.json"), File("contracts/family-trust-set/canonical-vectors.json"))
        return JSONObject((candidates.firstOrNull { it.exists() } ?: error("Shared Trust Set vectors missing")).readText())
    }
    private fun candidate(): UntrustedTrustSetEpoch = TrustSetEpochCodec.parseWire(fixtures().getJSONArray("vectors").getJSONObject(0).getJSONObject("wire").toString())
    private fun rejected(block: () -> Any?) {
        try { block(); fail("Expected structural rejection") } catch (_: TrustSetCodecException) { }
    }

    @Test fun `shared backend vectors match exact bytes hashes order and date range`() {
        val vectors = fixtures().getJSONArray("vectors")
        for (i in 0 until vectors.length()) {
            val fixture = vectors.getJSONObject(i)
            val epoch = TrustSetEpochCodec.parseWire(fixture.getString("wireJson"))
            val canonical = TrustSetEpochCodec.canonicalize(epoch)
            assertEquals(fixture.getString("name"), fixture.getString("canonical"), canonical)
            val hash = MessageDigest.getInstance("SHA-256").digest(canonical.toByteArray(Charsets.UTF_8))
                .joinToString("") { "%02x".format(it.toInt() and 0xff) }
            assertEquals(fixture.getString("sha256"), hash)
            val decoded = TrustSetEpochCodec.decodeCanonical(canonical.toByteArray(Charsets.UTF_8))
            assertEquals("", decoded.signature)
            assertEquals(epoch.copy(signature = ""), decoded)
            assertEquals(canonical, TrustSetEpochCodec.canonicalize(decoded))
        }
    }

    @Test fun `shared malformed canonical and wire corpus is rejected`() {
        val fixtures = fixtures()
        val canonical = fixtures.getJSONArray("rejectedCanonical")
        for (i in 0 until canonical.length()) {
            val fixture = canonical.getJSONObject(i)
            rejected {
                if (fixture.has("canonicalBytesBase64")) TrustSetEpochCodec.decodeCanonical(java.util.Base64.getDecoder().decode(fixture.getString("canonicalBytesBase64")))
                else TrustSetEpochCodec.decodeCanonical(fixture.getString("canonical"))
            }
        }
        val wire = fixtures.getJSONArray("rejectedWire")
        for (i in 0 until wire.length()) rejected { TrustSetEpochCodec.parseWire(wire.getJSONObject(i).getString("wireJson")) }
    }

    @Test fun `signature excluded and order preserved without granting semantic authority`() {
        val epoch = candidate()
        val base = TrustSetEpochCodec.canonicalize(epoch)
        assertEquals(base, TrustSetEpochCodec.canonicalize(epoch.copy(signature = "different")))
        assertEquals(base, TrustSetEpochCodec.canonicalize(epoch.copy(signature = "")))
        val entry = epoch.entries.single()
        val second = entry.copy(deviceId = "other", dskKeyId = "other-dsk", dekKeyId = "other-dek",
            dskPublicKey = "other-dsk-public", dekPublicKey = "other-dek-public")
        val multipleOwners = epoch.copy(entries = listOf(entry, second))
        val forward = TrustSetEpochCodec.canonicalize(multipleOwners)
        val backward = TrustSetEpochCodec.canonicalize(multipleOwners.copy(entries = listOf(second, entry)))
        assertNotEquals(forward, backward)
        // Structural candidate with two owners is representable, never accepted by this codec.
        assertEquals(2, TrustSetEpochCodec.decodeCanonical(forward).entries.size)
        assertEquals("", TrustSetEpochCodec.decodeCanonical(forward).signature)
    }

    @Test fun `UTF16 limits preserve supplementary scalars and exact normalization forms`() {
        val epoch = candidate().copy(familyId = "😀".repeat(64))
        val canonical = TrustSetEpochCodec.canonicalize(epoch)
        assertTrue(canonical.startsWith("256:"))
        assertEquals(epoch.copy(signature = ""), TrustSetEpochCodec.decodeCanonical(canonical))
        rejected { TrustSetEpochCodec.canonicalize(epoch.copy(familyId = epoch.familyId + "a")) }
        val distinct = candidate().copy(entries = listOf(candidate().entries.single().copy(dskPublicKey = "\u00E9", dekPublicKey = "e\u0301")))
        val restored = TrustSetEpochCodec.decodeCanonical(TrustSetEpochCodec.canonicalize(distinct))
        assertEquals("\u00E9", restored.entries.single().dskPublicKey)
        assertEquals("e\u0301", restored.entries.single().dekPublicKey)
        rejected { TrustSetEpochCodec.canonicalize(distinct.copy(entries = listOf(distinct.entries.single().copy(dekPublicKey = "\u00E9")))) }
    }

    @Test fun `unpaired UTF16 and malformed UTF8 are never silently replaced`() {
        for (value in listOf("\uD800", "\uDC00", "a\uD800b", "\uD800\uD800")) {
            rejected { TrustSetEpochCodec.canonicalize(candidate().copy(familyId = value)) }
            rejected { TrustSetEpochCodec.decodeCanonical("3:$value") }
        }
        for (bytes in listOf(byteArrayOf(0xc0.toByte(), 0xaf.toByte()), byteArrayOf(0xed.toByte(), 0xa0.toByte(), 0x80.toByte()),
            byteArrayOf(0xf0.toByte(), 0x9f.toByte(), 0x98.toByte()))) rejected { TrustSetEpochCodec.decodeCanonical(bytes) }
        val replacement = candidate().copy(familyId = "\uFFFD")
        assertEquals("\uFFFD", TrustSetEpochCodec.decodeCanonical(TrustSetEpochCodec.canonicalize(replacement)).familyId)
    }

    @Test fun `bounds and framing fail closed before narrowing or accepting trailing bytes`() {
        val epoch = candidate()
        rejected { TrustSetEpochCodec.canonicalize(epoch.copy(trustSetEpoch = 0)) }
        rejected { TrustSetEpochCodec.canonicalize(epoch.copy(keyEpoch = -1)) }
        rejected { TrustSetEpochCodec.canonicalize(epoch.copy(supersedesEpoch = 0)) }
        rejected { TrustSetEpochCodec.canonicalize(epoch.copy(entries = emptyList())) }
        rejected { TrustSetEpochCodec.canonicalize(epoch.copy(entries = List(65) { epoch.entries.single() })) }
        val canonical = TrustSetEpochCodec.canonicalize(epoch)
        rejected { TrustSetEpochCodec.decodeCanonical(canonical + "0:") }
        rejected { TrustSetEpochCodec.decodeCanonical("999999999999999999999:") }
        rejected { TrustSetEpochCodec.decodeCanonical("x".repeat(TrustSetEpochCodec.MAX_CANONICAL_UTF16_UNITS + 1)) }
        val raw = fixtures().getJSONArray("vectors").getJSONObject(0).getJSONObject("wire")
        rejected { TrustSetEpochCodec.parseWire(JSONObject(raw.toString()).put("signature", "s".repeat(513)).toString()) }
        rejected { TrustSetEpochCodec.parseWire(JSONObject(raw.toString()).put("signature", JSONObject.NULL).toString()) }
    }
}
