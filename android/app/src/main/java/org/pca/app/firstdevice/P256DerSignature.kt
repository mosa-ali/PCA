package org.pca.app.firstdevice

import java.math.BigInteger

/**
 * Wave 6C: JCA ECDSA signatures come back in DER (`SEQUENCE { INTEGER r,
 * INTEGER s }`), while the certified backend acceptance surface requires
 * the fixed-width IEEE-P1363 form (`r || s`, exactly 64 bytes) in LOW-S
 * canonical form (s <= n/2), unpadded base64url applied by the caller --
 * the exact surface of backend/src/deviceauth/P256DeviceSignatureVerifier.ts
 * and backend/src/familytrustset/P256TrustSetSignatureVerifier.ts.
 *
 * This converter is strict and total: it parses exactly one SEQUENCE
 * containing exactly two positive INTEGERs (1..33 content bytes each,
 * short/long form lengths), rejects negative/zero scalars and trailing
 * bytes, and normalizes high-S to `n - s`. A malformed JCA output is an
 * internal invariant violation, so callers may let the exception propagate
 * (fail closed); nothing here ever signs, recovers, or synthesizes a
 * signature.
 */
object P256DerSignature {
    /** P-256 group order `n` (SEC2 / FIPS 186-4), identical to the backend constant. */
    private val P256_ORDER = BigInteger("FFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551", 16)

    /** floor(n/2), the low-S bound the backend enforces (`s <= n/2`). */
    private val HALF_ORDER: BigInteger = P256_ORDER.shiftRight(1)

    private const val SEQUENCE_TAG = 0x30
    private const val INTEGER_TAG = 0x02

    /** Converts one DER ECDSA signature to canonical 64-byte low-S IEEE-P1363. */
    fun toLowSIeeeP1363(der: ByteArray): ByteArray {
        val (r, s) = parseDerSignature(der)
        if (r < BigInteger.ONE || r >= P256_ORDER) throw IllegalArgumentException("ECDSA r out of range")
        if (s < BigInteger.ONE || s >= P256_ORDER) throw IllegalArgumentException("ECDSA s out of range")
        val lowS = if (s > HALF_ORDER) P256_ORDER.subtract(s) else s
        val out = ByteArray(64)
        writeFixed32(r, out, 0)
        writeFixed32(lowS, out, 32)
        return out
    }

    /** Deterministic low-S normalization of one raw scalar (used by tests and mirrors). */
    fun toLowS(s: BigInteger): BigInteger = if (s > HALF_ORDER) P256_ORDER.subtract(s) else s

    /** Exposes the group order for parity tests (never for signing). */
    fun groupOrder(): BigInteger = P256_ORDER

    private fun parseDerSignature(der: ByteArray): Pair<BigInteger, BigInteger> {
        var cursor = 0
        fun readTag(): Int {
            require(cursor < der.size) { "truncated DER" }
            return der[cursor++].toInt() and 0xff
        }

        fun readLength(): Int {
            require(cursor < der.size) { "truncated DER length" }
            val first = der[cursor++].toInt() and 0xff
            if (first and 0x80 == 0) return first
            val count = first and 0x7f
            require(count in 1..4) { "unsupported DER length" }
            var length = 0
            repeat(count) {
                require(cursor < der.size) { "truncated DER long length" }
                length = (length shl 8) or (der[cursor++].toInt() and 0xff)
            }
            return length
        }

        fun readInteger(): BigInteger {
            require(readTag() == INTEGER_TAG) { "expected DER INTEGER" }
            val length = readLength()
            require(length in 1..33) { "integer length out of range" }
            require(cursor + length <= der.size) { "truncated DER integer" }
            require(der[cursor].toInt() and 0x80 == 0) { "negative DER integer" }
            val bytes = der.copyOfRange(cursor, cursor + length)
            cursor += length
            return BigInteger(1, bytes)
        }

        require(readTag() == SEQUENCE_TAG) { "expected DER SEQUENCE" }
        val sequenceLength = readLength()
        require(cursor + sequenceLength == der.size) { "DER length mismatch or trailing bytes" }
        val r = readInteger()
        val s = readInteger()
        require(cursor == der.size) { "trailing bytes after DER integers" }
        return r to s
    }

    private fun writeFixed32(value: BigInteger, destination: ByteArray, offset: Int) {
        val raw = value.toByteArray()
        when {
            raw.size == 32 -> raw.copyInto(destination, offset)
            raw.size == 33 && raw[0] == 0.toByte() -> raw.copyOfRange(1, 33).copyInto(destination, offset)
            raw.size < 32 -> raw.copyInto(destination, offset + (32 - raw.size))
            else -> throw IllegalArgumentException("scalar wider than 32 bytes")
        }
    }
}
