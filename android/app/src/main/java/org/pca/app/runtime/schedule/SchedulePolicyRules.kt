package org.pca.app.runtime.schedule

import java.time.Instant

/** Field-for-field conforming mirror of `backend/src/schedule/policy.ts`. */
fun validateScheduleWindow(window: ScheduleWindow): List<String> {
    val errors = mutableListOf<String>()
    for ((label, tod) in listOf("start" to window.start, "end" to window.end)) {
        if (tod.hour < 0 || tod.hour > 23) errors.add("window ${window.id}: $label.hour out of range")
        if (tod.minute < 0 || tod.minute > 59) errors.add("window ${window.id}: $label.minute out of range")
    }
    if (window.daysOfWeek.isEmpty()) errors.add("window ${window.id}: daysOfWeek must not be empty")
    for (day in window.daysOfWeek) {
        if (day < 0 || day > 6) errors.add("window ${window.id}: invalid daysOfWeek entry $day")
    }
    if (!isRecognizedTimezone(window.timezone)) errors.add("window ${window.id}: invalid timezone ${window.timezone}")
    return errors
}

/**
 * True when [nowUtc] falls inside [window], evaluated in the window's own authored timezone. A
 * window whose end-of-day minutes is not strictly after its start-of-day minutes is treated as
 * crossing midnight: it is active either during `[start, 24:00)` on a matching start day, or
 * during `[00:00, end)` on the calendar day immediately after a matching start day.
 */
fun isWindowActive(window: ScheduleWindow, nowUtc: Instant): Boolean {
    val zoned = toZonedWallClock(nowUtc, window.timezone)
    val nowMinutes = minutesOfDay(zoned.hour, zoned.minute)
    val startMinutes = minutesOfDay(window.start.hour, window.start.minute)
    val endMinutes = minutesOfDay(window.end.hour, window.end.minute)

    if (endMinutes > startMinutes) {
        return window.daysOfWeek.contains(zoned.weekday) && nowMinutes >= startMinutes && nowMinutes < endMinutes
    }

    val todayIsStartDay = window.daysOfWeek.contains(zoned.weekday) && nowMinutes >= startMinutes
    val yesterdayWeekday = (zoned.weekday + 6) % 7
    val yesterdayWasStartDay = window.daysOfWeek.contains(yesterdayWeekday) && nowMinutes < endMinutes
    return todayIsStartDay || yesterdayWasStartDay
}
