package org.pca.app.runtime.schedule

import java.time.Instant
import java.nio.CharBuffer
import java.nio.charset.CodingErrorAction
import java.nio.charset.StandardCharsets
import java.util.Base64

/** Field-for-field conforming mirror of `backend/src/schedule/policy.ts`. */
fun validateScheduleWindow(window: ScheduleWindow): List<String> {
    val errors = mutableListOf<String>()
    if (exactUtf8Identity(window.id) == null) errors.add("window id must be valid UTF-8 text")
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

/** Validates a complete policy window set, including the persistence-merge uniqueness rule.
 * Window identity is the exact UTF-8 byte sequence: no Unicode normalization or locale-sensitive
 * comparison is applied. Malformed UTF-16 that cannot represent a UTF-8 identity is rejected. */
fun validateScheduleWindows(windows: List<ScheduleWindow>): List<String> {
    val errors = windows.flatMap(::validateScheduleWindow).toMutableList()
    val seenIds = HashSet<String>()
    for (window in windows) {
        val identity = exactUtf8Identity(window.id) ?: continue
        if (!seenIds.add(identity)) errors.add("duplicate window id")
    }
    return errors
}

private fun exactUtf8Identity(value: String): String? = try {
    val encoded = StandardCharsets.UTF_8.newEncoder()
        .onMalformedInput(CodingErrorAction.REPORT)
        .onUnmappableCharacter(CodingErrorAction.REPORT)
        .encode(CharBuffer.wrap(value))
    val bytes = ByteArray(encoded.remaining())
    encoded.get(bytes)
    Base64.getEncoder().encodeToString(bytes)
} catch (_: java.nio.charset.CharacterCodingException) {
    null
}

/** PCA-FR-043B: owner-approved baseline used when a policy has not supplied a weaker bedtime
 * alternative. The window deliberately crosses midnight and is anchored to the policy timezone. */
object SchedulePolicyDefaults {
    const val DEFAULT_NIGHT_PROTECTION_ID = "default-night-protection"

    fun defaultNightProtection(timezone: String): ScheduleWindow = ScheduleWindow(
        id = DEFAULT_NIGHT_PROTECTION_ID,
        kind = ScheduleWindowKind.BEDTIME,
        daysOfWeek = (0..6).toList(),
        start = TimeOfDay(hour = 21, minute = 30),
        end = TimeOfDay(hour = 7, minute = 0),
        appScope = AppScope.All,
        timezone = timezone,
    )
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
