package org.pca.app.runtime.schedule

import org.json.JSONException
import org.json.JSONArray
import org.json.JSONObject
import java.math.BigDecimal
import java.math.BigInteger

/** Strict JSON-number decoding for schedule fields whose Kotlin representation is an Int.
 * Mirrors JavaScript `Number.isInteger`: integral decimal/exponent spellings are accepted, while
 * strings, fractional values, and values outside the signed 32-bit range are rejected before
 * narrowing. */
internal object ScheduleJsonIntegers {
    private val MIN = BigInteger.valueOf(Int.MIN_VALUE.toLong())
    private val MAX = BigInteger.valueOf(Int.MAX_VALUE.toLong())

    fun decode(value: Any, field: String): Int {
        val integer = when (value) {
            is Byte -> BigInteger.valueOf(value.toLong())
            is Short -> BigInteger.valueOf(value.toLong())
            is Int -> BigInteger.valueOf(value.toLong())
            is Long -> BigInteger.valueOf(value)
            is BigInteger -> value
            is BigDecimal -> exactInteger(value, field)
            is Double -> {
                if (!value.isFinite()) throw invalid(field)
                exactInteger(BigDecimal(value.toString()), field)
            }
            is Float -> {
                if (!value.isFinite()) throw invalid(field)
                exactInteger(BigDecimal(value.toString()), field)
            }
            else -> throw invalid(field)
        }
        if (integer < MIN || integer > MAX) throw invalid(field)
        return integer.toInt()
    }

    private fun exactInteger(value: BigDecimal, field: String): BigInteger = try {
        value.toBigIntegerExact()
    } catch (_: ArithmeticException) {
        throw invalid(field)
    }

    private fun invalid(field: String) = JSONException(
        "$field must be a signed 32-bit integer JSON number.",
    )
}

internal fun JSONObject.scheduleInt(key: String): Int = ScheduleJsonIntegers.decode(get(key), key)

internal fun JSONArray.scheduleInt(index: Int, field: String): Int =
    ScheduleJsonIntegers.decode(get(index), "$field[$index]")
