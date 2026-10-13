package org.pca.app.runtime.sync.envelope

import java.math.BigDecimal
import java.math.BigInteger
import org.json.JSONException
import org.json.JSONObject

/** Bounds protocol version components to the exact integer range shared by JSON implementations. */
internal object ProtocolVersionBounds {
    const val MAX_SAFE_INTEGER: Long = 9_007_199_254_740_991L
    private val MAX_SAFE_INTEGER_BIG_INTEGER = BigInteger.valueOf(MAX_SAFE_INTEGER)
    private val MAX_SAFE_INTEGER_BIG_DECIMAL = BigDecimal.valueOf(MAX_SAFE_INTEGER)

    fun requireMajor(value: Long) {
        require(value in 1L..MAX_SAFE_INTEGER) { "protocolMajor is outside the JSON safe-integer range." }
    }

    fun requireMinor(value: Long) {
        require(value in 0L..MAX_SAFE_INTEGER) { "protocolMinor is outside the JSON safe-integer range." }
    }

    fun decodeMajor(json: JSONObject): Long = decode(json, "protocolMajor", minimum = 1L)

    fun decodeMinor(json: JSONObject): Long = decode(json, "protocolMinor", minimum = 0L)

    private fun decode(json: JSONObject, field: String, minimum: Long): Long {
        val value = try {
            when (val raw = json.get(field)) {
                is Byte -> BigInteger.valueOf(raw.toLong())
                is Short -> BigInteger.valueOf(raw.toLong())
                is Int -> BigInteger.valueOf(raw.toLong())
                is Long -> BigInteger.valueOf(raw)
                is BigInteger -> raw
                is BigDecimal -> boundedInteger(raw, field, minimum)
                is Double -> {
                    if (!raw.isFinite()) throw invalid(field)
                    boundedInteger(BigDecimal(raw.toString()), field, minimum)
                }
                is Float -> {
                    if (!raw.isFinite()) throw invalid(field)
                    boundedInteger(BigDecimal(raw.toString()), field, minimum)
                }
                else -> throw invalid(field)
            }
        } catch (_: ArithmeticException) {
            throw invalid(field)
        }
        if (value < BigInteger.valueOf(minimum) || value > MAX_SAFE_INTEGER_BIG_INTEGER) {
            throw invalid(field)
        }
        // The validated protocol range is below Long.MAX_VALUE, so conversion is exact and
        // compatible with the app's API 26 minimum (BigInteger.longValueExact is API 31+).
        return value.toLong()
    }

    private fun invalid(field: String) = JSONException(
        "$field must be a JSON safe integer in the supported protocol-version range.",
    )

    private fun boundedInteger(value: BigDecimal, field: String, minimum: Long): BigInteger {
        if (value < BigDecimal.valueOf(minimum) || value > MAX_SAFE_INTEGER_BIG_DECIMAL) throw invalid(field)
        return try {
            value.toBigIntegerExact()
        } catch (_: ArithmeticException) {
            throw invalid(field)
        }
    }
}
