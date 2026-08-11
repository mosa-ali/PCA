package org.pca.app.feature.prayer.calc

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import org.pca.app.feature.prayer.model.AsrMethod
import org.pca.app.feature.prayer.model.CalculationMethod
import org.pca.app.feature.prayer.model.Coordinates
import org.pca.app.feature.prayer.model.PrayerName
import org.pca.app.feature.prayer.model.PrayerOffsets
import java.time.LocalDate
import java.time.ZoneId

class PrayerTimeCalculatorTest {

    // Mecca, used across tests as a representative low-latitude location.
    private val mecca = Coordinates(latitudeDegrees = 21.4225, longitudeDegrees = 39.8262)
    private val meccaZone = ZoneId.of("Asia/Riyadh")
    private val date = LocalDate.of(2026, 3, 15)

    private fun schedule(
        coordinates: Coordinates = mecca,
        zoneId: ZoneId = meccaZone,
        method: CalculationMethod = CalculationMethod.UMM_AL_QURA,
        asrMethod: AsrMethod = AsrMethod.STANDARD,
        offsets: PrayerOffsets = PrayerOffsets.NONE,
        onDate: LocalDate = date,
    ) = PrayerTimeCalculator.calculate(onDate, coordinates, zoneId, method, asrMethod, offsets)

    @Test
    fun `prayer times are chronologically ordered`() {
        val s = schedule()
        val fajr = requireNotNull(s.time(PrayerName.FAJR))
        val sunrise = requireNotNull(s.time(PrayerName.SUNRISE))
        val dhuhr = requireNotNull(s.time(PrayerName.DHUHR))
        val asr = requireNotNull(s.time(PrayerName.ASR))
        val maghrib = requireNotNull(s.time(PrayerName.MAGHRIB))
        val isha = requireNotNull(s.time(PrayerName.ISHA))

        assertTrue(fajr < sunrise)
        assertTrue(sunrise < dhuhr)
        assertTrue(dhuhr < asr)
        assertTrue(asr < maghrib)
        assertTrue(maghrib < isha)
    }

    @Test
    fun `dhuhr lands close to local solar noon`() {
        val dhuhr = requireNotNull(schedule().time(PrayerName.DHUHR))
        // Riyadh-zone civil noon vs true solar noon differ by at most ~20 minutes at this
        // longitude/date; this is a sanity bound, not a precision claim.
        assertTrue(dhuhr.hour in 11..13)
    }

    @Test
    fun `hanafi asr is never earlier than standard asr`() {
        val standard = requireNotNull(schedule(asrMethod = AsrMethod.STANDARD).time(PrayerName.ASR))
        val hanafi = requireNotNull(schedule(asrMethod = AsrMethod.HANAFI).time(PrayerName.ASR))

        assertTrue(hanafi >= standard)
    }

    @Test
    fun `different calculation methods produce different fajr and isha times`() {
        val mwl = schedule(method = CalculationMethod.MUSLIM_WORLD_LEAGUE)
        val isna = schedule(method = CalculationMethod.ISNA)

        assertNotEquals(mwl.time(PrayerName.FAJR), isna.time(PrayerName.FAJR))
        assertNotEquals(mwl.time(PrayerName.ISHA), isna.time(PrayerName.ISHA))
        // A larger Fajr angle (MWL: 18) means Fajr starts earlier than a smaller one (ISNA: 15).
        val mwlFajr = requireNotNull(mwl.time(PrayerName.FAJR))
        val isnaFajr = requireNotNull(isna.time(PrayerName.FAJR))
        assertTrue(mwlFajr < isnaFajr)
    }

    @Test
    fun `umm al-qura isha is a fixed offset after maghrib`() {
        val s = schedule(method = CalculationMethod.UMM_AL_QURA)
        val maghrib = requireNotNull(s.time(PrayerName.MAGHRIB))
        val isha = requireNotNull(s.time(PrayerName.ISHA))

        assertEquals(maghrib.plusMinutes(90), isha)
    }

    @Test
    fun `manual offsets shift the corresponding prayer by exactly that many minutes`() {
        val base = requireNotNull(schedule().time(PrayerName.FAJR))
        val offset = requireNotNull(
            schedule(offsets = PrayerOffsets(fajrMinutes = 7)).time(PrayerName.FAJR),
        )

        assertEquals(base.plusMinutes(7), offset)
    }

    @Test
    fun `negative manual offsets move a prayer earlier`() {
        val base = requireNotNull(schedule().time(PrayerName.ISHA))
        val offset = requireNotNull(
            schedule(offsets = PrayerOffsets(ishaMinutes = -10)).time(PrayerName.ISHA),
        )

        assertEquals(base.minusMinutes(10), offset)
    }

    @Test
    fun `offsets only affect their own prayer`() {
        val base = schedule()
        val offset = schedule(offsets = PrayerOffsets(fajrMinutes = 15))

        assertEquals(base.time(PrayerName.DHUHR), offset.time(PrayerName.DHUHR))
        assertEquals(base.time(PrayerName.ISHA), offset.time(PrayerName.ISHA))
    }

    @Test
    fun `invalid latitude is rejected`() {
        assertThrows(IllegalArgumentException::class.java) {
            Coordinates(latitudeDegrees = 91.0, longitudeDegrees = 0.0)
        }
    }

    @Test
    fun `invalid longitude is rejected`() {
        assertThrows(IllegalArgumentException::class.java) {
            Coordinates(latitudeDegrees = 0.0, longitudeDegrees = 181.0)
        }
    }

    @Test
    fun `midnight and date rollover produce a consistent schedule for the following calendar day`() {
        val today = schedule(onDate = date)
        val tomorrow = schedule(onDate = date.plusDays(1))

        val todayIsha = requireNotNull(today.time(PrayerName.ISHA))
        val tomorrowFajr = requireNotNull(tomorrow.time(PrayerName.FAJR))

        assertTrue(todayIsha < tomorrowFajr)
        assertEquals(date.plusDays(1), tomorrow.date)
    }

    @Test
    fun `dst spring-forward date still produces a chronologically ordered schedule`() {
        // US DST began 2026-03-08 (second Sunday of March).
        val nyZone = ZoneId.of("America/New_York")
        val nyCoords = Coordinates(latitudeDegrees = 40.7128, longitudeDegrees = -74.0060)
        val s = schedule(coordinates = nyCoords, zoneId = nyZone, onDate = LocalDate.of(2026, 3, 8))

        val fajr = requireNotNull(s.time(PrayerName.FAJR))
        val isha = requireNotNull(s.time(PrayerName.ISHA))
        assertTrue(fajr < isha)
        assertEquals(nyZone, fajr.zone)
    }

    @Test
    fun `dst fall-back date still produces a chronologically ordered schedule`() {
        // US DST ended 2026-11-01 (first Sunday of November).
        val nyZone = ZoneId.of("America/New_York")
        val nyCoords = Coordinates(latitudeDegrees = 40.7128, longitudeDegrees = -74.0060)
        val s = schedule(coordinates = nyCoords, zoneId = nyZone, onDate = LocalDate.of(2026, 11, 1))

        val fajr = requireNotNull(s.time(PrayerName.FAJR))
        val isha = requireNotNull(s.time(PrayerName.ISHA))
        assertTrue(fajr < isha)
    }

    @Test
    fun `same instant displayed in two different timezones differs only by civil offset`() {
        val utcSchedule = schedule(zoneId = ZoneId.of("UTC"))
        val riyadhSchedule = schedule(zoneId = ZoneId.of("Asia/Riyadh"))

        val utcDhuhr = requireNotNull(utcSchedule.time(PrayerName.DHUHR))
        val riyadhDhuhr = requireNotNull(riyadhSchedule.time(PrayerName.DHUHR))

        assertEquals(utcDhuhr.toInstant(), riyadhDhuhr.toInstant())
        assertNotEquals(utcDhuhr.hour, riyadhDhuhr.hour)
    }
}
