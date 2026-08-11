package org.pca.app.feature.prayer.model

/**
 * Twilight parameters for locating Fajr and Isha. Isha is either angle-based (solar depression
 * below the horizon, like Fajr) or a fixed number of minutes after Maghrib.
 */
sealed interface IshaConvention {
    data class Angle(val degrees: Double) : IshaConvention
    data class MinutesAfterMaghrib(val minutes: Int) : IshaConvention
}

enum class CalculationMethod(
    val methodName: String,
    val fajrAngleDegrees: Double,
    val isha: IshaConvention,
) {
    MUSLIM_WORLD_LEAGUE("Muslim World League", 18.0, IshaConvention.Angle(17.0)),
    ISNA("Islamic Society of North America", 15.0, IshaConvention.Angle(15.0)),
    EGYPTIAN("Egyptian General Authority of Survey", 19.5, IshaConvention.Angle(17.5)),
    UMM_AL_QURA("Umm al-Qura University, Makkah", 18.5, IshaConvention.MinutesAfterMaghrib(90)),
    KARACHI("University of Islamic Sciences, Karachi", 18.0, IshaConvention.Angle(18.0)),
    TEHRAN("Institute of Geophysics, University of Tehran", 17.7, IshaConvention.Angle(14.0)),
}
