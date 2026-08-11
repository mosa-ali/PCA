package org.pca.app.feature.prayer.calc

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.pca.app.feature.prayer.model.AsrMethod
import org.pca.app.feature.prayer.model.CalculationMethod
import org.pca.app.feature.prayer.model.Coordinates
import org.pca.app.feature.prayer.model.HighLatitudeRule
import org.pca.app.feature.prayer.model.ManualHighLatitudeOffsets
import org.pca.app.feature.prayer.model.PrayerName
import org.pca.app.feature.prayer.model.PrayerOffsets
import org.pca.app.feature.prayer.model.PrayerTimeMethod
import org.pca.app.feature.prayer.model.PrayerTimeOutcome
import java.time.LocalDate
import java.time.ZoneId
import kotlin.time.Duration.Companion.minutes

/**
 * FINDING-004: near-midsummer at a high-enough latitude, the true astronomical Fajr/Isha angle
 * has no solution. Reykjavik (64.15N) in late June is a reliable, real-world case of this.
 */
class HighLatitudePrayerTimeTest {

    private val reykjavik = Coordinates(latitudeDegrees = 64.1466, longitudeDegrees = -21.9426)
    private val zone = ZoneId.of("Atlantic/Reykjavik")
    private val midsummer = LocalDate.of(2026, 6, 21)

    private fun outcome(rule: HighLatitudeRule, manual: ManualHighLatitudeOffsets? = null, prayer: PrayerName) =
        PrayerTimeCalculator.calculate(
            midsummer,
            reykjavik,
            zone,
            CalculationMethod.MUSLIM_WORLD_LEAGUE,
            AsrMethod.STANDARD,
            PrayerOffsets.NONE,
            highLatitudeRule = rule,
            manualHighLatitudeOffsets = manual,
        ).outcome(prayer)

    @Test
    fun `plain astronomical fajr has no solution at this latitude and date`() {
        // Sanity check on the premise of this whole test class: without a high-latitude rule,
        // the raw hour-angle calculation genuinely cannot place Fajr on this day.
        val rawFajr = SolarCalculator.hourAngleDegrees(
            zenithDegrees = 90.0 + CalculationMethod.MUSLIM_WORLD_LEAGUE.fajrAngleDegrees,
            latitudeDegrees = reykjavik.latitudeDegrees,
            declinationRadians = SolarCalculator.sunPosition(midsummer).declinationRadians,
        )
        assertEquals(null, rawFajr)
    }

    @Test
    fun `angle-based rule resolves fajr and isha instead of returning a bare null`() {
        val fajr = outcome(HighLatitudeRule.ANGLE_BASED, prayer = PrayerName.FAJR)
        val isha = outcome(HighLatitudeRule.ANGLE_BASED, prayer = PrayerName.ISHA)

        assertTrue(fajr is PrayerTimeOutcome.Resolved)
        assertTrue(isha is PrayerTimeOutcome.Resolved)
        assertEquals(PrayerTimeMethod.HIGH_LATITUDE_ANGLE_BASED, (fajr as PrayerTimeOutcome.Resolved).method)
        assertEquals(PrayerTimeMethod.HIGH_LATITUDE_ANGLE_BASED, (isha as PrayerTimeOutcome.Resolved).method)
    }

    @Test
    fun `one-seventh rule resolves fajr and isha with the one-seventh method tag`() {
        val fajr = outcome(HighLatitudeRule.ONE_SEVENTH, prayer = PrayerName.FAJR) as PrayerTimeOutcome.Resolved
        assertEquals(PrayerTimeMethod.HIGH_LATITUDE_ONE_SEVENTH, fajr.method)
    }

    @Test
    fun `middle-of-night rule resolves fajr and isha with the middle-of-night method tag`() {
        val fajr = outcome(HighLatitudeRule.MIDDLE_OF_NIGHT, prayer = PrayerName.FAJR) as PrayerTimeOutcome.Resolved
        assertEquals(PrayerTimeMethod.HIGH_LATITUDE_MIDDLE_OF_NIGHT, fajr.method)
    }

    @Test
    fun `the three automatic rules place fajr at different times`() {
        val angleBased = (outcome(HighLatitudeRule.ANGLE_BASED, prayer = PrayerName.FAJR) as PrayerTimeOutcome.Resolved).at
        val oneSeventh = (outcome(HighLatitudeRule.ONE_SEVENTH, prayer = PrayerName.FAJR) as PrayerTimeOutcome.Resolved).at
        val middleOfNight = (outcome(HighLatitudeRule.MIDDLE_OF_NIGHT, prayer = PrayerName.FAJR) as PrayerTimeOutcome.Resolved).at

        assertTrue(angleBased != oneSeventh || oneSeventh != middleOfNight)
    }

    @Test
    fun `manual family choice rule resolves using the supplied offsets`() {
        val manual = ManualHighLatitudeOffsets(fajrBeforeSunrise = 90.minutes, ishaAfterMaghrib = 90.minutes)
        val sunriseOutcome = outcome(HighLatitudeRule.MANUAL_FAMILY_CHOICE, manual, PrayerName.SUNRISE)
        val sunrise = (sunriseOutcome as PrayerTimeOutcome.Resolved).at

        val fajr = outcome(HighLatitudeRule.MANUAL_FAMILY_CHOICE, manual, PrayerName.FAJR) as PrayerTimeOutcome.Resolved
        assertEquals(PrayerTimeMethod.HIGH_LATITUDE_MANUAL_FAMILY_OFFSET, fajr.method)
        assertEquals(sunrise.minusMinutes(90), fajr.at)
    }

    @Test
    fun `manual family choice without supplied offsets needs a family choice rather than guessing`() {
        val fajr = outcome(HighLatitudeRule.MANUAL_FAMILY_CHOICE, manual = null, prayer = PrayerName.FAJR)
        assertEquals(PrayerTimeOutcome.NeedsFamilyChoice, fajr)
    }

    @Test
    fun `dhuhr never needs a family choice, even at extreme latitude`() {
        // Dhuhr is solar transit, which has no dependency on a solvable hour angle.
        val dhuhr = outcome(HighLatitudeRule.ANGLE_BASED, prayer = PrayerName.DHUHR)
        assertTrue(dhuhr is PrayerTimeOutcome.Resolved)
    }

    @Test
    fun `an ordinary low-latitude location never needs a high-latitude fallback`() {
        val schedule = PrayerTimeCalculator.calculate(
            LocalDate.of(2026, 3, 15),
            Coordinates(latitudeDegrees = 21.4225, longitudeDegrees = 39.8262),
            ZoneId.of("Asia/Riyadh"),
            CalculationMethod.UMM_AL_QURA,
            AsrMethod.STANDARD,
        )

        PrayerName.entries.forEach { prayer ->
            val result = schedule.outcome(prayer)
            assertTrue("$prayer unexpectedly needed a high-latitude fallback", result is PrayerTimeOutcome.Resolved)
            assertEquals(PrayerTimeMethod.ASTRONOMICAL, (result as PrayerTimeOutcome.Resolved).method)
        }
    }
}
