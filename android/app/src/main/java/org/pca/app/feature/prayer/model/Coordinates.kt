package org.pca.app.feature.prayer.model

data class Coordinates(
    val latitudeDegrees: Double,
    val longitudeDegrees: Double,
    val elevationMeters: Double = 0.0,
) {
    init {
        require(latitudeDegrees in -90.0..90.0) { "latitude must be in [-90, 90], was $latitudeDegrees" }
        require(longitudeDegrees in -180.0..180.0) { "longitude must be in [-180, 180], was $longitudeDegrees" }
        require(!latitudeDegrees.isNaN() && !longitudeDegrees.isNaN()) { "coordinates must not be NaN" }
        require(elevationMeters.isFinite()) { "elevation must be finite" }
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
