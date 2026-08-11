package org.pca.app.feature.prayer.model

/**
 * Deliberately does not accept an elevation: this calculator uses the standard flat-horizon
 * solar zenith angles (see [org.pca.app.feature.prayer.calc.PrayerTimeCalculator]) and does not
 * apply an elevation-based horizon-dip correction, so accepting an `elevationMeters` value here
 * would silently be ignored. If elevation-aware correction is required later, add it explicitly
 * to the calculator alongside a parameter here rather than resurrecting an unused field.
 */
data class Coordinates(
    val latitudeDegrees: Double,
    val longitudeDegrees: Double,
) {
    init {
        require(latitudeDegrees in -90.0..90.0) { "latitude must be in [-90, 90], was $latitudeDegrees" }
        require(longitudeDegrees in -180.0..180.0) { "longitude must be in [-180, 180], was $longitudeDegrees" }
        require(!latitudeDegrees.isNaN() && !longitudeDegrees.isNaN()) { "coordinates must not be NaN" }
    }
}

/** Per-prayer manual minute offsets applied after the astronomical calculation. */
data class PrayerOffsets(
    val fajrMinutes: Int = 0,
    val sunriseMinutes: Int = 0,
    val dhuhrMinutes: Int = 0,
    val asrMinutes: Int = 0,
    val maghribMinutes: Int = 0,
    val ishaMinutes: Int = 0,
) {
    fun forPrayer(prayer: PrayerName): Int = when (prayer) {
        PrayerName.FAJR -> fajrMinutes
        PrayerName.SUNRISE -> sunriseMinutes
        PrayerName.DHUHR -> dhuhrMinutes
        PrayerName.ASR -> asrMinutes
        PrayerName.MAGHRIB -> maghribMinutes
        PrayerName.ISHA -> ishaMinutes
    }

    companion object {
        val NONE = PrayerOffsets()
    }
}
