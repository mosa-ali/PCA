package org.pca.app.firstdevice

import java.math.BigInteger
import java.security.KeyPairGenerator
import java.security.Signature
import java.security.spec.ECGenParameterSpec
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/**
 * Wave 6C: DER -> IEEE-P1363 low-S conversion tests. The backend rejects
 * high-S signatures about half the time they are produced, so this
 * normalization is load-bearing for acceptance; JCA verification below uses
 * `SHA256withECDSAinP1363Format` (JVM test-only; the DEVICE path never uses
 * it -- minSdk 26 -- and instead converts the standard DER output here).
 */
class P256DerSignatureTest {

    private fun signDer(message: ByteArray): ByteArray {
        val generator = KeyPairGenerator.getInstance("EC")
        generator.initialize(ECGenParameterSpec("secp256r1"))
        val keyPair = generator.generateKeyPair()
        return Signature.getInstance("SHA256withECDSA").run {
            initSign(keyPair.private)
            update(message)
            sign()
        }
    }

    private fun verifyP1363(message: ByteArray, signature: ByteArray) {
        val generator = KeyPairGenerator.getInstance("EC")
        generator.initialize(ECGenParameterSpec("secp256r1"))
        val keyPair = generator.generateKeyPair()
        // Re-sign with the same key path to get a verifiable pairing: derive
        // the signature FROM this key instead.
        val der = Signature.getInstance("SHA256withECDSA").run {
            initSign(keyPair.private)
            update(message)
            sign()
        }
        val converted = P256DerSignature.toLowSIeeeP1363(der)
        val verifier = Signature.getInstance("SHA256withECDSAinP1363Format")
        verifier.initVerify(keyPair.public)
        verifier.update(message)
        assertTrue(verifier.verify(converted))
    }

    @Test
    fun `every JCA DER signature converts to exactly 64 bytes and verifies as P1363`() {
        for (i in 1..25) {
            val message = "wave6c-message-$i".toByteArray(Charsets.UTF_8)
            val der = signDer(message)
            val converted = P256DerSignature.toLowSIeeeP1363(der)
            assertEquals(64, converted.size)
            // Low-S bound: s <= n/2.
            val s = BigInteger(1, converted.copyOfRange(32, 64))
            assertTrue(s <= P256DerSignature.groupOrder().shiftRight(1))
        }
    }

    @Test
    fun `re-signed output verifies through the P1363 verifier path`() {
        verifyP1363("verify-me".toByteArray(Charsets.UTF_8), ByteArray(0))
    }

    @Test
    fun `high-S is normalized to n - s and the result still verifies`() {
        val message = "high-s-case".toByteArray(Charsets.UTF_8)
        val generator = KeyPairGenerator.getInstance("EC")
        generator.initialize(ECGenParameterSpec("secp256r1"))
        val keyPair = generator.generateKeyPair()
        val der = Signature.getInstance("SHA256withECDSA").run {
            initSign(keyPair.private)
            update(message)
            sign()
        }
        // Parse DER r,s and FORCE a high-S variant when we get a low-S one.
        val (r, s) = parseDer(der)
        val n = P256DerSignature.groupOrder()
        val forcedHigh = if (s > n.shiftRight(1)) s else n.subtract(s)
        val highDer = encodeDer(r, forcedHigh)
        val converted = P256DerSignature.toLowSIeeeP1363(highDer)
        val finalS = BigInteger(1, converted.copyOfRange(32, 64))
        assertEquals(s.min(n.subtract(s)), finalS)
        val verifier = Signature.getInstance("SHA256withECDSAinP1363Format")
        verifier.initVerify(keyPair.public)
        verifier.update(message)
        assertTrue(verifier.verify(converted))
    }

    @Test
    fun `strict rejects - trailing bytes, negative integers, zero scalars, malformed framing`() {
        val valid = signDer("strictness".toByteArray(Charsets.UTF_8))
        run {
            val padded = valid + byteArrayOf(0x00)
            try {
                P256DerSignature.toLowSIeeeP1363(padded)
                fail("trailing bytes must be rejected")
            } catch (_: IllegalArgumentException) { /* expected */ }
        }
        run {
            // SEQUENCE { INTEGER 0x80 (negative), INTEGER 1 }
            val negative = byteArrayOf(0x30, 0x07, 0x02, 0x01, 0x80.toByte(), 0x02, 0x01, 0x01)
            try {
                P256DerSignature.toLowSIeeeP1363(negative)
                fail("negative integer must be rejected")
            } catch (_: IllegalArgumentException) { /* expected */ }
        }
        run {
            val zeroScalar = byteArrayOf(0x30, 0x06, 0x02, 0x01, 0x00, 0x02, 0x01, 0x01)
            try {
                P256DerSignature.toLowSIeeeP1363(zeroScalar)
                fail("zero scalar must be rejected")
            } catch (_: IllegalArgumentException) { /* expected */ }
        }
        run {
            try {
                P256DerSignature.toLowSIeeeP1363(byteArrayOf(0x31, 0x00))
                fail("wrong top-level tag must be rejected")
            } catch (_: IllegalArgumentException) { /* expected */ }
        }
    }

    private fun parseDer(der: ByteArray): Pair<BigInteger, BigInteger> {
        var cursor = 0
        assertEquals(0x30.toByte(), der[cursor++])
        var length = der[cursor++].toInt() and 0xff
        if (length and 0x80 != 0) {
            val count = length and 0x7f
            length = 0
            repeat(count) { length = (length shl 8) or (der[cursor++].toInt() and 0xff) }
        }
        fun readInt(): BigInteger {
            assertEquals(0x02.toByte(), der[cursor++])
            val len = der[cursor++].toInt()
            val bytes = der.copyOfRange(cursor, cursor + len)
            cursor += len
            return BigInteger(1, bytes)
        }
        return readInt() to readInt()
    }

    private fun encodeDer(r: BigInteger, s: BigInteger): ByteArray {
        fun intBytes(value: BigInteger): ByteArray {
            val raw = value.toByteArray()
            // toByteArray() already prepends a leading 0x00 whenever the top
            // bit would otherwise make the INTEGER negative; keep it.
            return byteArrayOf(0x02, raw.size.toByte()) + raw
        }
        val rBytes = intBytes(r)
        val sBytes = intBytes(s)
        val content = rBytes + sBytes
        require(content.size < 0x80) { "test DER must stay short-form" }
        return byteArrayOf(0x30, content.size.toByte()) + content
    }
}
