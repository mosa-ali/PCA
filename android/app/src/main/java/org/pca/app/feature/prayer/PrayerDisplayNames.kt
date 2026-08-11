package org.pca.app.feature.prayer

import org.pca.app.R
import org.pca.app.feature.prayer.model.PrayerName

/**
 * Presentation-layer mapping from [PrayerName] (PCA-3/9's calculation-domain enum, untouched by
 * PCA-16) to a localized, resource-backed display string. This is intentionally a SEPARATE file
 * from `PrayerName.kt` -- that enum's `arabicName`/`englishName` fields remain business/
 * calculation data owned by the prayer-time lane; this mapping is the only place PCA-16 renders
 * a prayer name to a screen reader or on-screen label, and it always resolves through Android's
 * locale-qualified string resources (never the enum's own hardcoded fields) so the display text
 * follows the DEVICE's selected language, not calculation logic.
 */
fun PrayerName.displayNameRes(): Int =
    when (this) {
        PrayerName.FAJR -> R.string.prayer_name_fajr
        PrayerName.SUNRISE -> R.string.prayer_name_sunrise
        PrayerName.DHUHR -> R.string.prayer_name_dhuhr
        PrayerName.ASR -> R.string.prayer_name_asr
        PrayerName.MAGHRIB -> R.string.prayer_name_maghrib
        PrayerName.ISHA -> R.string.prayer_name_isha
    }
