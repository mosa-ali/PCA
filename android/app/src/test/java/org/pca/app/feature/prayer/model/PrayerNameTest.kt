package org.pca.app.feature.prayer.model

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PrayerNameTest {

    @Test
    fun `every prayer has a non-blank arabic and english name`() {
        PrayerName.entries.forEach {
            assertTrue("${it.name} missing arabic name", it.arabicName.isNotBlank())
            assertTrue("${it.name} missing english name", it.englishName.isNotBlank())
        }
    }

    @Test
    fun `fajr names are correct`() {
        assertEquals("Fajr", PrayerName.FAJR.englishName)
        assertEquals("الفجر", PrayerName.FAJR.arabicName)
    }

    @Test
    fun `sunrise is not counted as one of the five daily prayers`() {
        assertEquals(5, PrayerName.entries.count { it.isPrayer })
        assertTrue(PrayerName.entries.none { it != PrayerName.SUNRISE && !it.isPrayer })
    }
}
