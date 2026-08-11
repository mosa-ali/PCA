package org.pca.app.feature.prayer.schedule

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.pca.app.feature.prayer.calc.PrayerTimeCalculator
import org.pca.app.feature.prayer.model.AsrMethod
import org.pca.app.feature.prayer.model.CalculationMethod
import org.pca.app.feature.prayer.model.Coordinates
import org.pca.app.feature.prayer.model.PrayerName
import java.time.LocalDate
import java.time.ZoneId

class NextPrayerResolverTest {

    private val mecca = Coordinates(latitudeDegrees = 21.4225, longitudeDegrees = 39.8262)
    private val zone = ZoneId.of("Asia/Riyadh")
    private val date = LocalDate.of(2026, 3, 15)

    private fun scheduleFor(onDate: LocalDate) = PrayerTimeCalculator.calculate(
        onDate,
        mecca,
        zone,
        CalculationMethod.UMM_AL_QURA,
        AsrMethod.STANDARD,
    )

    @Test
    fun `next prayer just before dhuhr is dhuhr`() {
        val today = scheduleFor(date)
        val tomorrow = scheduleFor(date.plusDays(1))
        val dhuhr = requireNotNull(today.time(PrayerName.DHUHR))

        val result = requireNotNull(NextPrayerResolver.resolve(dhuhr.minusMinutes(1), today, tomorrow))

        assertEquals(PrayerName.DHUHR, result.prayer)
        assertEquals(dhuhr, result.at)
    }

    @Test
    fun `at the exact instant of a prayer, next prayer is the following one`() {
        val today = scheduleFor(date)
        val tomorrow = scheduleFor(date.plusDays(1))
        val dhuhr = requireNotNull(today.time(PrayerName.DHUHR))
        val asr = requireNotNull(today.time(PrayerName.ASR))

        val result = requireNotNull(NextPrayerResolver.resolve(dhuhr, today, tomorrow))

        assertEquals(PrayerName.ASR, result.prayer)
        assertEquals(asr, result.at)
    }

    @Test
    fun `after isha, next prayer rolls over to tomorrow's fajr`() {
        val today = scheduleFor(date)
        val tomorrow = scheduleFor(date.plusDays(1))
        val isha = requireNotNull(today.time(PrayerName.ISHA))
        val tomorrowFajr = requireNotNull(tomorrow.time(PrayerName.FAJR))

        val result = requireNotNull(NextPrayerResolver.resolve(isha.plusMinutes(1), today, tomorrow))

        assertEquals(PrayerName.FAJR, result.prayer)
        assertEquals(tomorrowFajr, result.at)
    }

    @Test
    fun `sunrise is never returned as the next prayer`() {
        val today = scheduleFor(date)
        val tomorrow = scheduleFor(date.plusDays(1))
        val fajr = requireNotNull(today.time(PrayerName.FAJR))

        val result = requireNotNull(NextPrayerResolver.resolve(fajr.plusMinutes(1), today, tomorrow))

        assertEquals(PrayerName.DHUHR, result.prayer)
    }

    @Test
    fun `no prayers at all resolves to null`() {
        val emptySchedule = DailyPrayerSchedule(date, zone, PrayerName.entries.associateWith { null })
        assertNull(NextPrayerResolver.resolve(scheduleFor(date).time(PrayerName.DHUHR)!!, emptySchedule, emptySchedule))
    }
}
