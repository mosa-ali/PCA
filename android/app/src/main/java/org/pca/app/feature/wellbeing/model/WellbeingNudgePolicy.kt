package org.pca.app.feature.wellbeing.model

import kotlin.time.Duration
import kotlin.time.Duration.Companion.hours
import kotlin.time.Duration.Companion.minutes

/**
 * Parent-owned configuration surface (PCA-WELL-007). Positive terminology only -- deliberately
 * there is no "nag intensity" or similarly framed control; the closest lever is
 * [periodicNudgesEnabled] plus [maximumDailyNudges]/[minimumInterval].
 */
data class WellbeingNudgePolicy(
    val enabled: Boolean = true,
    val eligibleApps: Set<String> = emptySet(),
    val enabledCategories: Set<WellbeingCategory> = WellbeingCategory.entries.toSet(),
    val faithContentEnabled: Boolean = true,
    val lockScreenSuggestionsEnabled: Boolean = true,
    val periodicNudgesEnabled: Boolean = true,
    val gameReturnNudgeEnabled: Boolean = true,
    val breakSuggestionsEnabled: Boolean = true,
    val quietHoursStartMinuteOfDay: Int? = null,
    val quietHoursEndMinuteOfDay: Int? = null,
    val minimumInterval: Duration = 20.minutes,
    val maximumDailyNudges: Int = 6,
    val sameSuggestionRepeatCooldown: Duration = 24.hours,
    val gameReturnWindow: Duration = 3.minutes,
    val durationPreferences: Set<DurationBucket> = DurationBucket.entries.toSet(),
    val childCanSnooze: Boolean = true,
    val childCanMarkNotHelpful: Boolean = true,
    val parentCanAddCustomSuggestions: Boolean = true,
    /** When true, parent panel previews are restricted to aggregate counts only -- never which
     * specific suggestion the child rejected (PCA-WELL-017). This is the *stronger* setting;
     * turning it off requires a separately justified parent policy and is NOT the default. */
    val privacyMode: Boolean = true,
) {
    init {
        require(maximumDailyNudges >= 0) { "maximumDailyNudges must not be negative" }
        require(minimumInterval.isPositive() || minimumInterval == Duration.ZERO) {
            "minimumInterval must not be negative"
        }
        require(quietHoursStartMinuteOfDay?.let { it in 0..1439 } ?: true) {
            "quietHoursStartMinuteOfDay must be within a single day"
        }
        require(quietHoursEndMinuteOfDay?.let { it in 0..1439 } ?: true) {
            "quietHoursEndMinuteOfDay must be within a single day"
        }
    }

    /** True iff [minuteOfDay] falls in the configured quiet window, correctly handling a window
     * that wraps past midnight (e.g. 21:00-07:00). No quiet window configured => never quiet. */
    fun isQuietAt(minuteOfDay: Int): Boolean {
        val start = quietHoursStartMinuteOfDay ?: return false
        val end = quietHoursEndMinuteOfDay ?: return false
        return if (start <= end) {
            minuteOfDay in start until end
        } else {
            minuteOfDay >= start || minuteOfDay < end
        }
    }
}
