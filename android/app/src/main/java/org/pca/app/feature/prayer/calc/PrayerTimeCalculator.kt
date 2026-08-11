package org.pca.app.feature.prayer.calc

import org.pca.app.feature.prayer.model.AsrMethod
import org.pca.app.feature.prayer.model.CalculationMethod
import org.pca.app.feature.prayer.model.Coordinates
import org.pca.app.feature.prayer.model.IshaConvention
import org.pca.app.feature.prayer.model.PrayerName
import org.pca.app.feature.prayer.model.PrayerOffsets
import org.pca.app.feature.prayer.schedule.DailyPrayerSchedule
import java.time.Instant
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.ZonedDateTime

/**
 * Deterministic, offline prayer-time calculation. No network access, no Android dependency —
 * pure function of (date, coordinates, timezone, method, Asr convention, manual offsets).
 * Timezone/DST handling is delegated entirely to [java.time.ZoneId]: every intermediate
 * computation happens in UTC and is converted to [zoneId] exactly once, at the end.
 */
object PrayerTimeCalculator {

    /** Standard solar zenith angle for sunrise/sunset accounting for atmospheric refraction
     * and the sun's apparent radius. */
    private const val SUNRISE_SUNSET_ZENITH_DEGREES = 90.833

    fun calculate(
        date: java.time.LocalDate,
        coordinates: Coordinates,
        zoneId: ZoneId,
        method: CalculationMethod,
        asrMethod: AsrMethod,
        offsets: PrayerOffsets = PrayerOffsets.NONE,
    ): DailyPrayerSchedule {
        val sun = SolarCalculator.sunPosition(date)
        val solarNoonMinutes = SolarCalculator.solarNoonUtcMinutes(date, coordinates.longitudeDegrees)
        val dayStartUtc = date.atStartOfDay(ZoneOffset.UTC).toInstant()

        fun instantAtMinutes(minutesFromUtcMidnight: Double): Instant {
            val nanos = Math.round(minutesFromUtcMidnight * 60_000_000_000.0)
            return dayStartUtc.plusNanos(nanos)
        }

        fun hourAngle(zenithDegrees: Double): Double? =
            SolarCalculator.hourAngleDegrees(zenithDegrees, coordinates.latitudeDegrees, sun.declinationRadians)

        val fajrHourAngle = hourAngle(90.0 + method.fajrAngleDegrees)
        val sunriseSunsetHourAngle = hourAngle(SUNRISE_SUNSET_ZENITH_DEGREES)
        val asrAltitude = SolarCalculator.asrAltitudeDegrees(asrMethod.shadowFactor, coordinates.latitudeDegrees, sun.declinationRadians)
        val asrHourAngle = hourAngle(90.0 - asrAltitude)

        val fajrInstant = fajrHourAngle?.let { instantAtMinutes(solarNoonMinutes - 4.0 * it) }
        val sunriseInstant = sunriseSunsetHourAngle?.let { instantAtMinutes(solarNoonMinutes - 4.0 * it) }
        val dhuhrInstant = instantAtMinutes(solarNoonMinutes)
        val asrInstant = asrHourAngle?.let { instantAtMinutes(solarNoonMinutes + 4.0 * it) }
        val maghribInstant = sunriseSunsetHourAngle?.let { instantAtMinutes(solarNoonMinutes + 4.0 * it) }

        val ishaInstant = when (val isha = method.isha) {
            is IshaConvention.Angle -> hourAngle(90.0 + isha.degrees)?.let { instantAtMinutes(solarNoonMinutes + 4.0 * it) }
            is IshaConvention.MinutesAfterMaghrib -> maghribInstant?.plusSeconds(isha.minutes * 60L)
        }

        fun withOffset(instant: Instant?, prayer: PrayerName): ZonedDateTime? =
            instant?.plusSeconds(offsets.forPrayer(prayer) * 60L)?.atZone(zoneId)

        val times = mapOf(
            PrayerName.FAJR to withOffset(fajrInstant, PrayerName.FAJR),
            PrayerName.SUNRISE to withOffset(sunriseInstant, PrayerName.SUNRISE),
            PrayerName.DHUHR to withOffset(dhuhrInstant, PrayerName.DHUHR),
            PrayerName.ASR to withOffset(asrInstant, PrayerName.ASR),
            PrayerName.MAGHRIB to withOffset(maghribInstant, PrayerName.MAGHRIB),
            PrayerName.ISHA to withOffset(ishaInstant, PrayerName.ISHA),
        )

        return DailyPrayerSchedule(date = date, zoneId = zoneId, times = times)
    }
}
