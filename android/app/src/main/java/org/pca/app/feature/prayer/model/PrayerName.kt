package org.pca.app.feature.prayer.model

/** The five daily prayers plus sunrise (used as a calculation anchor, not a prayer itself). */
enum class PrayerName(val arabicName: String, val englishName: String, val isPrayer: Boolean) {
    FAJR(arabicName = "الفجر", englishName = "Fajr", isPrayer = true),
    SUNRISE(arabicName = "الشروق", englishName = "Sunrise", isPrayer = false),
    DHUHR(arabicName = "الظهر", englishName = "Dhuhr", isPrayer = true),
    ASR(arabicName = "العصر", englishName = "Asr", isPrayer = true),
    MAGHRIB(arabicName = "المغرب", englishName = "Maghrib", isPrayer = true),
    ISHA(arabicName = "العشاء", englishName = "Isha", isPrayer = true),
}
