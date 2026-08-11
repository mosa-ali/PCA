package org.pca.app.feature.prayer.calc

import java.time.LocalDate
import kotlin.math.PI
import kotlin.math.acos
import kotlin.math.atan
import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.tan
import kotlin.math.abs

/**
 * Low-precision solar position (NOAA approximation, good to roughly +/-1 minute), sufficient
 * for prayer-time scheduling and fully offline: no ephemeris download, no network call.
 *
 * All outputs are anchored to UTC minutes-from-midnight for [date]; callers convert to a local
 * display zone via [java.time.ZoneId] afterwards, which is what makes DST handling automatic
 * and correct — this calculator never touches civil clock/timezone rules itself.
 */
internal object SolarCalculator {

    data class SunPosition(val declinationRadians: Double, val equationOfTimeMinutes: Double)

    /** Fractional-year angle gamma, in radians, for the given day-of-year (NOAA approximation
     * evaluated at local solar noon, i.e. hour = 12). */
    private fun fractionalYear(dayOfYear: Int, daysInYear: Int): Double =
        2.0 * PI / daysInYear * (dayOfYear - 1)

    fun sunPosition(date: LocalDate): SunPosition {
        val daysInYear = if (date.isLeapYear) 366 else 365
        val gamma = fractionalYear(date.dayOfYear, daysInYear)

        val eqTime = 229.18 * (
            0.000075 +
                0.001868 * cos(gamma) -
                0.032077 * sin(gamma) -
                0.014615 * cos(2 * gamma) -
                0.040849 * sin(2 * gamma)
            )

        val decl = 0.006918 -
            0.399912 * cos(gamma) +
            0.070257 * sin(gamma) -
            0.006758 * cos(2 * gamma) +
            0.000907 * sin(2 * gamma) -
            0.002697 * cos(3 * gamma) +
            0.00148 * sin(3 * gamma)

        return SunPosition(declinationRadians = decl, equationOfTimeMinutes = eqTime)
    }

    /** Solar noon, in minutes from UTC midnight of [date] (may be fractional, and may in
     * principle land outside [0, 1440) which correctly indicates the true UTC instant falls on
     * an adjacent UTC calendar day for extreme longitudes). */
    fun solarNoonUtcMinutes(date: LocalDate, longitudeDegrees: Double): Double {
        val eqTime = sunPosition(date).equationOfTimeMinutes
        return 720.0 - 4.0 * longitudeDegrees - eqTime
    }

    /**
     * Hour angle (degrees) for the moment the sun's true zenith angle equals [zenithDegrees],
     * i.e. altitude = 90 - zenithDegrees. Returns null when the event never occurs on this day
     * at this latitude (midnight sun / polar night), since the arccos argument falls outside
     * [-1, 1].
     */
    fun hourAngleDegrees(zenithDegrees: Double, latitudeDegrees: Double, declinationRadians: Double): Double? {
        val latRad = Math.toRadians(latitudeDegrees)
        val zenithRad = Math.toRadians(zenithDegrees)
        val cosH = (cos(zenithRad) - sin(latRad) * sin(declinationRadians)) /
            (cos(latRad) * cos(declinationRadians))
        if (cosH < -1.0 || cosH > 1.0) return null
        return Math.toDegrees(acos(cosH))
    }

    /** Altitude angle (degrees) at which an object's shadow is [shadowFactor] times its noon
     * shadow beyond the noon shadow itself — the standard Asr definition. */
    fun asrAltitudeDegrees(shadowFactor: Int, latitudeDegrees: Double, declinationRadians: Double): Double {
        val latRad = Math.toRadians(latitudeDegrees)
        val diff = abs(latRad - declinationRadians)
        return Math.toDegrees(atan(1.0 / (shadowFactor + tan(diff))))
    }
}
