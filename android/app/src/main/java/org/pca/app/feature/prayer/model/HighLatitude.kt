package org.pca.app.feature.prayer.model

import java.time.ZonedDateTime
import kotlin.time.Duration

/**
 * At high latitudes (roughly above the polar circles' influence in summer/winter) the true
 * solar-depression-angle definition of Fajr/Isha has no astronomical solution — the sun never
 * gets far enough below the horizon. This policy selects how to approximate them from the
 * (still well-defined) Sunrise/Maghrib times instead of returning an unexplained null.
 */
enum class HighLatitudeRule {
    /** Scale the night into the same angle/60 fraction the astronomical calculation would have
     * used, had it been solvable — the most common convention. */
    ANGLE_BASED,

    /** Divide the night into sevenths; Fajr = Sunrise - night/7, Isha = Maghrib + night/7. */
    ONE_SEVENTH,

    /** Fajr and Isha each sit at the midpoint of the night from Sunrise/Maghrib. */
    MIDDLE_OF_NIGHT,

    /** Use a family-supplied fixed offset from Sunrise/Maghrib instead of any automatic rule.
     * Requires [ManualHighLatitudeOffsets] to be supplied; without it this rule cannot produce
     * a value and resolves to [PrayerTimeOutcome.NeedsFamilyChoice]. */
    MANUAL_FAMILY_CHOICE,
}

/** Fixed offsets used only when [HighLatitudeRule.MANUAL_FAMILY_CHOICE] is selected. */
data class ManualHighLatitudeOffsets(
    val fajrBeforeSunrise: Duration,
    val ishaAfterMaghrib: Duration,
)

enum class PrayerTimeMethod {
    ASTRONOMICAL,
    HIGH_LATITUDE_ANGLE_BASED,
    HIGH_LATITUDE_ONE_SEVENTH,
    HIGH_LATITUDE_MIDDLE_OF_NIGHT,
    HIGH_LATITUDE_MANUAL_FAMILY_OFFSET,
}

/**
 * The result of resolving a single prayer time. Deliberately never a bare nullable
 * [ZonedDateTime]: when neither the astronomical calculation nor the configured
 * [HighLatitudeRule] can safely produce a value, that is surfaced as the explicit
 * [NeedsFamilyChoice] case instead, so a caller cannot mistake "we couldn't compute this" for
 * an ordinary missing map entry.
 */
sealed interface PrayerTimeOutcome {
    data class Resolved(val at: ZonedDateTime, val method: PrayerTimeMethod) : PrayerTimeOutcome
    data object NeedsFamilyChoice : PrayerTimeOutcome
}
