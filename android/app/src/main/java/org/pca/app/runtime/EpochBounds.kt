package org.pca.app.runtime

import org.json.JSONException
import org.json.JSONObject
import java.math.BigDecimal
import java.math.BigInteger

/** Shared numeric domain for Android epoch counters. Zero remains available to callers that use
 * it as an unset floor; field-specific minimums stay with their existing authority validators. */
internal object EpochBounds {
    const val MAX: Int = Int.MAX_VALUE
    private val MAX_BIG_INTEGER: BigInteger = BigInteger.valueOf(MAX.toLong())
    private val MAX_BIG_DECIMAL: BigDecimal = BigDecimal.valueOf(MAX.toLong())

    fun isValid(value: Int): Boolean = value >= 0

    fun isValid(value: Long): Boolean = value in 0L..MAX.toLong()

    fun requireValid(value: Int, field: String) {
        require(isValid(value)) { "$field is outside the supported epoch range." }
    }

    fun requireValid(value: Long, field: String) {
        require(isValid(value)) { "$field is outside the supported epoch range." }
    }

    /** Matches parsed JSON-number semantics while checking before narrowing: integral numeric
     * forms such as `1`, `1.0`, and `1e0` are accepted; strings, fractions, negatives, and values
     * above INT32_MAX are rejected. */
    fun decodeJson(json: JSONObject, field: String): Int {
        val raw = json.get(field)
        val integer = when (raw) {
            is Byte -> BigInteger.valueOf(raw.toLong())
            is Short -> BigInteger.valueOf(raw.toLong())
            is Int -> BigInteger.valueOf(raw.toLong())
            is Long -> BigInteger.valueOf(raw)
            is BigInteger -> {
                if (raw.signum() < 0 || raw > MAX_BIG_INTEGER) throw invalidJsonEpoch(field)
                raw
            }
            is BigDecimal -> try {
                if (raw.signum() < 0 || raw > MAX_BIG_DECIMAL) throw invalidJsonEpoch(field)
                raw.toBigIntegerExact()
            } catch (_: ArithmeticException) {
                throw invalidJsonEpoch(field)
            }
            is Double -> {
                if (!raw.isFinite()) {
                    throw invalidJsonEpoch(field)
                }
                val decimal = BigDecimal(raw.toString())
                if (decimal.signum() < 0 || decimal > MAX_BIG_DECIMAL) throw invalidJsonEpoch(field)
                exactIntegerOrInvalid(decimal, field)
            }
            is Float -> {
                if (!raw.isFinite()) {
                    throw invalidJsonEpoch(field)
                }
                val decimal = BigDecimal(raw.toString())
                if (decimal.signum() < 0 || decimal > MAX_BIG_DECIMAL) throw invalidJsonEpoch(field)
                exactIntegerOrInvalid(decimal, field)
            }
            else -> throw invalidJsonEpoch(field)
        }
        if (integer.signum() < 0 || integer > MAX_BIG_INTEGER) throw invalidJsonEpoch(field)
        return integer.toInt()
    }

    private fun invalidJsonEpoch(field: String) = JSONException(
        "$field must be an integer from 0 through $MAX.",
    )

    private fun exactIntegerOrInvalid(value: BigDecimal, field: String): BigInteger = try {
        value.toBigIntegerExact()
    } catch (_: ArithmeticException) {
        throw invalidJsonEpoch(field)
    }
}
