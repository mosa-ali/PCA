package org.pca.app.feature.wellbeing.policy

/**
 * Evaluates a parent-authored [SdkScheduleWindow] (types.ts `ScheduleWindow`, doc 36 section 8 --
 * "presentation-window scheduling only") against a wall-clock snapshot. This is a *message-level
 * schedule eligibility* concern, deliberately kept separate from PCA bedtime suppression (doc 35
 * WELL-3, [org.pca.app.feature.wellbeing.ports.WellbeingScheduleContextSource]) per doc 35's own
 * `NudgeDeliveryStatus.SUPPRESSED_PCA_BEDTIME` vs. wellbeing-quiet-hours distinction, and per item
 * 14 of the PCA-RUNTIME-WELL-1 task spec: this evaluator never reimplements bedtime/schedule
 * logic, and [org.pca.app.feature.wellbeing.ports.WellbeingScheduleContextSource] is untouched and
 * still consulted, unchanged, by [org.pca.app.feature.wellbeing.engine.NudgeSelectionEngine].
 *
 * Wall-clock only (display/scheduling use, matching doc 36 section 8's own carve-out) -- never
 * used for elapsed-time/rate-limit math, which stays [org.pca.app.foundation.MonotonicTimeSource]
 * territory inside the existing engine.
 */
object ScheduleWindowEvaluator {

    /** Device-local wall-clock snapshot. [isoDate] is `YYYY-MM-DD`, [dayOfWeek] one of
     * `MON`..`SUN`, [minuteOfDay] in `[0, 1440)`. Timezone handling: [SdkScheduleWindow.timezoneId],
     * when present, is NOT converted -- this evaluator always uses the device's own local wall
     * clock (consistent with [org.pca.app.feature.wellbeing.ports.WallClockCalendarSource], which
     * has no timezone-conversion capability either). This is a documented, deliberate limitation,
     * not a silent bug: doc 36 section 8 only requires *syntactic* timezone validity, and Android's
     * device-local clock is already the correct behavior for the common case (single-device,
     * single-timezone family use). Cross-timezone scheduling is out of scope for this worktree. */
    data class WallClockSnapshot(
        val isoDate: String,
        val dayOfWeek: String,
        val minuteOfDay: Int,
    )

    fun isActiveNow(schedule: SdkScheduleWindow, now: WallClockSnapshot): Boolean {
        schedule.startDate?.let { if (now.isoDate < it) return false }
        schedule.endDate?.let { if (now.isoDate > it) return false }

        if (schedule.daysOfWeek.isNotEmpty() && now.dayOfWeek !in schedule.daysOfWeek) return false

        if (schedule.timeWindows.isNotEmpty()) {
            val inAnyWindow = schedule.timeWindows.any { window -> minuteInWindow(now.minuteOfDay, window) }
            if (!inAnyWindow) return false
        }

        return true
    }

    /** Handles a midnight-crossing window (`startMinute > endMinute`) the same way
     * [org.pca.app.feature.wellbeing.model.WellbeingNudgePolicy.isQuietAt] does for wellbeing's own
     * quiet-hours fields. */
    private fun minuteInWindow(minuteOfDay: Int, window: SdkTimeWindow): Boolean =
        if (window.startMinute <= window.endMinute) {
            minuteOfDay in window.startMinute until window.endMinute
        } else {
            minuteOfDay >= window.startMinute || minuteOfDay < window.endMinute
        }
}
