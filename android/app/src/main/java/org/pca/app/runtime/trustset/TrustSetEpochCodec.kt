package org.pca.app.runtime.trustset

import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.time.LocalDateTime
import java.time.ZoneOffset
import org.json.JSONObject
import org.pca.app.runtime.EpochBounds

/** Backend familytrustset structural grammar only. Nothing decoded here can authorize an ACK or application. */
object TrustSetEpochCodec {
    const val MAX_CANONICAL_UTF16_UNITS = 262144
    private const val MAX_WIRE_UTF16_UNITS = 1048576
    private val decimal = Regex("^(0|[1-9][0-9]*)$")
    private val iso = Regex("^([0-9]{4}|[+-][0-9]{6})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})\\.([0-9]{3})Z$")

    fun parseWire(json: String): UntrustedTrustSetEpoch = checked {
        require(json.length <= MAX_WIRE_UTF16_UNITS)
        val raw = JSONObject(json)
        fun text(key: String): String = (raw.get(key) as? String) ?: malformed()
        require(raw.has("supersedesEpoch"))
        val prior = if (raw.get("supersedesEpoch") === JSONObject.NULL) null else EpochBounds.decodeJson(raw, "supersedesEpoch")
        val array = raw.getJSONArray("entries")
        require(array.length() in 1..64)
        val entries = (0 until array.length()).map { index ->
            val entry = array.getJSONObject(index)
            fun field(key: String): String = (entry.get(key) as? String) ?: malformed()
            UntrustedTrustSetEntry(field("deviceId"), TrustSetRole.valueOf(field("role")),
                field("dskKeyId"), field("dskPublicKey"), field("dekKeyId"), field("dekPublicKey"),
                TrustSetMembershipStatus.valueOf(field("status")))
        }
        val result = UntrustedTrustSetEpoch(text("familyId"), EpochBounds.decodeJson(raw, "trustSetEpoch"),
            EpochBounds.decodeJson(raw, "keyEpoch"), entries, text("issuedAt"), prior, text("signature"))
        validate(result)
        require(result.signature.length in 1..512 && wellFormed(result.signature))
        result
    }

    fun canonicalize(epoch: UntrustedTrustSetEpoch): String = checked {
        val snapshot = epoch.copy(entries = epoch.entries.toList())
        validate(snapshot)
        val fields = mutableListOf(snapshot.familyId, snapshot.trustSetEpoch.toString(), snapshot.keyEpoch.toString(), snapshot.entries.size.toString())
        snapshot.entries.forEach { entry -> fields.addAll(listOf(entry.deviceId, entry.role.name,
            entry.dskKeyId, entry.dskPublicKey, entry.dekKeyId, entry.dekPublicKey, entry.status.name)) }
        fields.add(snapshot.issuedAt)
        fields.add(snapshot.supersedesEpoch?.toString() ?: "null")
        // Explicit field list deliberately excludes the signature.
        fields.joinToString("") { "${it.toByteArray(Charsets.UTF_8).size}:$it" }.also {
            require(it.length <= MAX_CANONICAL_UTF16_UNITS)
        }
    }

    fun decodeCanonical(input: String): UntrustedTrustSetEpoch = checked {
        require(input.length <= MAX_CANONICAL_UTF16_UNITS && wellFormed(input))
        decodeCanonical(input.toByteArray(Charsets.UTF_8))
    }

    fun decodeCanonical(bytes: ByteArray): UntrustedTrustSetEpoch = checked {
        // At most three UTF-8 bytes per UTF-16 unit; reject abusive input before decoding.
        require(bytes.size <= MAX_CANONICAL_UTF16_UNITS * 3)
        require(strictUtf8(bytes).length <= MAX_CANONICAL_UTF16_UNITS)
        var cursor = 0
        fun field(): String {
            val start = cursor
            while (cursor < bytes.size && bytes[cursor].toInt() in 48..57) cursor++
            require(cursor > start && cursor < bytes.size && bytes[cursor].toInt() == 58)
            val length = integer(String(bytes, start, cursor - start, Charsets.US_ASCII), 0)
            cursor++
            require(length <= bytes.size - cursor)
            val value = strictUtf8(bytes.copyOfRange(cursor, cursor + length))
            cursor += length
            return value
        }
        val family = field()
        val trust = integer(field(), 1)
        val key = integer(field(), 0)
        val count = integer(field(), 1)
        require(count <= 64)
        val entries = (0 until count).map {
            UntrustedTrustSetEntry(field(), TrustSetRole.valueOf(field()), field(), field(), field(), field(),
                TrustSetMembershipStatus.valueOf(field()))
        }
        val date = field()
        val previous = field().let { if (it == "null") null else integer(it, 1) }
        require(cursor == bytes.size)
        UntrustedTrustSetEpoch(family, trust, key, entries, date, previous).also { validate(it) }
    }

    private fun validate(epoch: UntrustedTrustSetEpoch) {
        require(opaque(epoch.familyId) && epoch.trustSetEpoch >= 1 && epoch.keyEpoch >= 0)
        require(epoch.supersedesEpoch == null || epoch.supersedesEpoch >= 1)
        require(epoch.entries.size in 1..64)
        epoch.entries.forEach { entry ->
            require(listOf(entry.deviceId, entry.dskKeyId, entry.dskPublicKey, entry.dekKeyId, entry.dekPublicKey).all(::opaque))
            require(entry.dskPublicKey != entry.dekPublicKey)
        }
        requireExactIso(epoch.issuedAt)
    }

    private fun integer(token: String, minimum: Int): Int {
        require(token.length <= 10 && decimal.matches(token))
        return (token.toIntOrNull() ?: malformed()).also { require(it >= minimum) }
    }

    private fun opaque(value: String) = value.length in 1..128 && wellFormed(value)

    private fun wellFormed(value: String): Boolean {
        var i = 0
        while (i < value.length) {
            val unit = value[i]
            if (Character.isHighSurrogate(unit)) {
                if (i + 1 >= value.length || !Character.isLowSurrogate(value[i + 1])) return false
                i++
            } else if (Character.isLowSurrogate(unit)) return false
            i++
        }
        return true
    }

    private fun strictUtf8(bytes: ByteArray): String = Charsets.UTF_8.newDecoder()
        .onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT)
        .decode(ByteBuffer.wrap(bytes)).toString()

    private fun requireExactIso(value: String) {
        require(value.length in 24..27)
        val match = iso.matchEntire(value) ?: malformed()
        val year = match.groupValues[1].toInt()
        val expectedYear = if (year in 0..9999) year.toString().padStart(4, '0')
            else (if (year < 0) "-" else "+") + kotlin.math.abs(year).toString().padStart(6, '0')
        require(match.groupValues[1] == expectedYear)
        val fields = match.groupValues.drop(2).map { it.toInt() }
        val date = LocalDateTime.of(year, fields[0], fields[1], fields[2], fields[3], fields[4], fields[5] * 1000000)
        val millis = date.toInstant(ZoneOffset.UTC).toEpochMilli()
        require(millis in -8640000000000000L..8640000000000000L)
    }

    private fun malformed(): Nothing = throw TrustSetCodecException()
    private inline fun <T> checked(block: () -> T): T = try { block() }
    catch (error: TrustSetCodecException) { throw error }
    catch (_: Exception) { throw TrustSetCodecException() }
}
