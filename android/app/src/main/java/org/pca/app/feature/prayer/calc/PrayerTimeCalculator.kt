package org.pca.app.feature.prayer.calc

import org.pca.app.feature.prayer.model.AsrMethod
import org.pca.app.feature.prayer.model.CalculationMethod
import org.pca.app.feature.prayer.model.Coordinates
import org.pca.app.feature.prayer.model.HighLatitudeRule
import org.pca.app.feature.prayer.model.IshaConvention
import org.pca.app.feature.prayer.model.ManualHighLatitudeOffsets
import org.pca.app.feature.prayer.model.PrayerName
import org.pca.app.feature.prayer.model.PrayerOffsets
import org.pca.app.feature.prayer.model.PrayerTimeMethod
import org.pca.app.feature.prayer.model.PrayerTimeOutcome
import org.pca.app.feature.prayer.schedule.DailyPrayerSchedule
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZoneOffset

/**
 * Deterministic, offline prayer-time calculation. No network access, no Android dependency —
 * pure function of (date, coordinates, timezone, method, Asr convention, manual offsets,
 * high-latitude policy). Timezone/DST handling is delegated entirely to [java.time.ZoneId]:
 * every intermediate computation happens in UTC and is converted to [ZoneId] exactly once, at
 * the end.
 *
 * At high latitudes the true solar-depression-angle definition of Fajr/Isha can have no
 * astronomical solution (the sun never gets far enough below the horizon). Rather than exposing
 * that as an unexplained null, [highLatitudeRule] selects how to approximate them from
 * Sunrise/Maghrib, and any prayer that still cannot be safely resolved (including Asr, for
 * which no standard high-latitude convention exists) comes back as
 * [PrayerTimeOutcome.NeedsFamilyChoice].
 */
object PrayerTimeCalculator {

    private const val SUNRISE_SUNSET_ZENITH_DEGREES = 90.833
    private const val DAY_NANOS = 86_400_000_000_000L

    fun calculate(
        date: LocalDate,
        coordinates: Coordinates,
        zoneId: ZoneId,
        method: CalculationMethod,
        asrMethod: AsrMethod,
        offsets: PrayerOffsets = PrayerOffsets.NONE,
        highLatitudeRule: HighLatitudeRule = HighLatitudeRule.ANGLE_BASED,
        manualHighLatitudeOffsets: ManualHighLatitudeOffsets? = null,
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

        val ishaAngleInstant = (method.isha as? IshaConvention.Angle)?.let { convention ->
            hourAngle(90.0 + convention.degrees)?.let { instantAtMinutes(solarNoonMinutes + 4.0 * it) }
        }
        val ishaInstant = when (val isha = method.isha) {
            is IshaConvention.Angle -> ishaAngleInstant
            is IshaConvention.MinutesAfterMaghrib -> maghribInstant?.plusSeconds(isha.minutes * 60L)
        }

        val nightNanos: Long? = if (sunriseInstant != null && maghribInstant != null) {
            DAY_NANOS - java.time.Duration.between(sunriseInstant, maghribInstant).toNanos()
        } else {
            null
        }

        fun highLatitudeFallbackNanos(angleDegrees: Double): Long? = when (highLatitudeRule) {
            HighLatitudeRule.ANGLE_BASED -> nightNanos?.let { Math.round(it * (angleDegrees / 60.0)) }
            HighLatitudeRule.ONE_SEVENTH -> nightNanos?.let { it / 7 }
            HighLatitudeRule.MIDDLE_OF_NIGHT -> nightNanos?.let { it / 2 }
            HighLatitudeRule.MANUAL_FAMILY_CHOICE -> null // resolved separately, per-prayer, below
        }

        val highLatitudeMethod = when (highLatitudeRule) {
            HighLatitudeRule.ANGLE_BASED -> PrayerTimeMethod.HIGH_LATITUDE_ANGLE_BASED
            HighLatitudeRule.ONE_SEVENTH -> PrayerTimeMethod.HIGH_LATITUDE_ONE_SEVENTH
            HighLatitudeRule.MIDDLE_OF_NIGHT -> PrayerTimeMethod.HIGH_LATITUDE_MIDDLE_OF_NIGHT
            HighLatitudeRule.MANUAL_FAMILY_CHOICE -> PrayerTimeMethod.HIGH_LATITUDE_MANUAL_FAMILY_OFFSET
        }

        fun fajrFallback(): Pair<Instant, PrayerTimeMethod>? {
            if (sunriseInstant == null) return null
            if (highLatitudeRule == HighLatitudeRule.MANUAL_FAMILY_CHOICE) {
                val offset = manualHighLatitudeOffsets?.fajrBeforeSunrise ?: return null
                return sunriseInstant.minusNanos(offset.inWholeNanoseconds) to highLatitudeMethod
            }
            val fallbackNanos = highLatitudeFallbackNanos(method.fajrAngleDegrees) ?: return null
            return sunriseInstant.minusNanos(fallbackNanos) to highLatitudeMethod
        }

        fun ishaFallback(): Pair<Instant, PrayerTimeMethod>? {
            if (maghribInstant == null) return null
            if (highLatitudeRule == HighLatitudeRule.MANUAL_FAMILY_CHOICE) {
                val offset = manualHighLatitudeOffsets?.ishaAfterMaghrib ?: return null
                return maghribInstant.plusNanos(offset.inWholeNanoseconds) to highLatitudeMethod
            }
            val ishaAngle = (method.isha as? IshaConvention.Angle)?.degrees ?: return null
            val fallbackNanos = highLatitudeFallbackNanos(ishaAngle) ?: return null
            return maghribInstant.plusNanos(fallbackNanos) to highLatitudeMethod
        }

        fun toOutcome(resolved: Pair<Instant, PrayerTimeMethod>?, prayer: PrayerName): PrayerTimeOutcome =
            if (resolved == null) {
                PrayerTimeOutcome.NeedsFamilyChoice
            } else {
                val (instant, computationMethod) = resolved
                PrayerTimeOutcome.Resolved(
                    at = instant.plusSeconds(offsets.forPrayer(prayer) * 60L).atZone(zoneId),
                    method = computationMethod,
                )
            }

        val fajrOutcome = toOutcome(
            fajrInstant?.let { it to PrayerTimeMethod.ASTRONOMICAL } ?: fajrFallback(),
            PrayerName.FAJR,
        )
        val sunriseOutcome = toOutcome(sunriseInstant?.let { it to PrayerTimeMethod.ASTRONOMICAL }, PrayerName.SUNRISE)
        val dhuhrOutcome = toOutcome(dhuhrInstant to PrayerTimeMethod.ASTRONOMICAL, PrayerName.DHUHR)
        // No standard high-latitude convention exists for Asr; an unsolvable Asr always needs a
        // family choice rather than guessing.
        val asrOutcome = toOutcome(asrInstant?.let { it to PrayerTimeMethod.ASTRONOMICAL }, PrayerName.ASR)
        val maghribOutcome = toOutcome(maghribInstant?.let { it to PrayerTimeMethod.ASTRONOMICAL }, PrayerName.MAGHRIB)
        val ishaOutcome = toOutcome(
            ishaInstant?.let { it to PrayerTimeMethod.ASTRONOMICAL } ?: ishaFallback(),
            PrayerName.ISHA,
        )

        val outcomes = mapOf(
            PrayerName.FAJR to fajrOutcome,
            PrayerName.SUNRISE to sunriseOutcome,
            PrayerName.DHUHR to dhuhrOutcome,
            PrayerName.ASR to asrOutcome,
            PrayerName.MAGHRIB to maghribOutcome,
            PrayerName.ISHA to ishaOutcome,
        )

        return DailyPrayerSchedule(date = date, zoneId = zoneId, outcomes = outcomes)
    }
}
