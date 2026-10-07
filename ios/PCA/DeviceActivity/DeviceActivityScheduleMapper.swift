import Foundation
#if canImport(DeviceActivity)
import DeviceActivity
import ManagedSettings
#endif

/// Translates a `ScheduleWindow` (PCA-4 policy, already verified/decrypted
/// upstream) into the `DeviceActivitySchedule`/`DeviceActivityEvent`
/// primitives Apple's DeviceActivity framework uses (doc 07 Section 7).
/// This is a pure MAPPING layer -- it invents no new policy semantics; the
/// only decision authority is `ScheduleEngine` (same file family as the
/// backend/Android engines it mirrors).
public enum DeviceActivityBoundaryPlanError: Error, Equatable {
    case malformedBoundary
    case excessiveMonitors
}

public enum DeviceActivityScheduleMapper {
    /// Apple supports twenty activities app-wide. Reserve one for health;
    /// reject the complete plan rather than silently dropping required edges.
    public static func boundaryTriggers(for policy: DecodedSchedulePolicy, now: Date) throws -> [DeviceActivityBoundaryTrigger] {
        guard now.timeIntervalSince1970.isFinite else { throw DeviceActivityBoundaryPlanError.malformedBoundary }
        var triggers = Set<DeviceActivityBoundaryTrigger>()
        for window in policy.windows {
            guard ScheduleEngine.validate(window).isEmpty else { throw DeviceActivityBoundaryPlanError.malformedBoundary }
            // Daily recurrence deliberately includes unselected weekdays. The
            // engine resolves weekday, cross-midnight and precedence at use.
            for time in [window.start, window.end] {
                triggers.insert(.recurring(timeZoneIdentifier: window.timeZone.identifier, hour: time.hour, minute: time.minute))
            }
        }
        if policy.dailyLimit != nil {
            triggers.insert(.recurring(timeZoneIdentifier: policy.timeZone.identifier, hour: 0, minute: 0))
        }
        for date in policy.exceptions.flatMap({ [$0.startAt, $0.endAt] }) + policy.bonusGrants.flatMap({ [$0.grantedAt, $0.expiresAt] }) {
            let trigger = DeviceActivityBoundaryTrigger.absolute(utc: date)
            guard trigger.isValid else { throw DeviceActivityBoundaryPlanError.malformedBoundary }
            if date > now { triggers.insert(trigger) }
        }
        guard triggers.allSatisfy({ $0.isValid }) else { throw DeviceActivityBoundaryPlanError.malformedBoundary }
        guard triggers.count <= 19 else { throw DeviceActivityBoundaryPlanError.excessiveMonitors }
        // Stable ordering makes installation failure-position tests reproducible.
        return triggers.sorted { sortKey($0) < sortKey($1) }
    }

    private static func sortKey(_ trigger: DeviceActivityBoundaryTrigger) -> String {
        switch trigger {
        case let .recurring(zone, hour, minute): return "r:\(zone):\(hour * 60 + minute)"
        case let .absolute(date): return "a:\(date.timeIntervalSince1970)"
        }
    }

    #if canImport(DeviceActivity)
    /// Captures the technical monitoring calendar once per installation. The
    /// callback planner persists this calendar's timezone so its expected
    /// recurrence boundaries are identical to the schedule sent to iOS.
    public static func monitoringCalendar() -> Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = .current
        return calendar
    }

    /// A full-day repeating callback envelope. The host cannot encode PCA's
    /// weekday/precedence/exception semantics into DeviceActivitySchedule;
    /// those semantics remain in ScheduleEngine and are re-evaluated by the
    /// monitor extension on every callback.
    public static func monitoringSchedule(calendar: Calendar) -> DeviceActivitySchedule {
        var intervalStart = DateComponents()
        intervalStart.calendar = calendar
        intervalStart.timeZone = calendar.timeZone
        intervalStart.hour = 0
        intervalStart.minute = 0

        var intervalEnd = DateComponents()
        intervalEnd.calendar = calendar
        intervalEnd.timeZone = calendar.timeZone
        intervalEnd.hour = 23
        intervalEnd.minute = 59

        return DeviceActivitySchedule(
            intervalStart: intervalStart,
            intervalEnd: intervalEnd,
            repeats: true
        )
    }

    /// Twelve-hour auxiliary envelopes avoid encoding short policy windows as
    /// unsupported monitoring intervals. Extra end callbacks only reevaluate
    /// the engine; they carry no allow/block authority. Apple remains the
    /// authority on DST interpretation and actual callback delivery.
    public static func boundarySchedule(for trigger: DeviceActivityBoundaryTrigger) -> DeviceActivitySchedule {
        var calendar = Calendar(identifier: .gregorian)
        let start: DateComponents
        let end: DateComponents
        let repeats: Bool
        switch trigger {
        case let .recurring(zone, hour, minute):
            calendar.timeZone = TimeZone(identifier: zone)!
            var first = DateComponents()
            first.calendar = calendar; first.timeZone = calendar.timeZone
            first.hour = hour; first.minute = minute; first.second = 0
            var last = first
            last.hour = (hour + 12) % 24
            start = first; end = last; repeats = true
        case let .absolute(date):
            calendar.timeZone = TimeZone(secondsFromGMT: 0)!
            var first = calendar.dateComponents([.year, .month, .day, .hour, .minute, .second], from: date)
            first.calendar = calendar; first.timeZone = calendar.timeZone
            var last = calendar.dateComponents([.year, .month, .day, .hour, .minute, .second], from: date.addingTimeInterval(12 * 3600))
            last.calendar = calendar; last.timeZone = calendar.timeZone
            start = first; end = last
            repeats = false
        }
        return DeviceActivitySchedule(intervalStart: start, intervalEnd: end, repeats: repeats)
    }

    /// A `BEDTIME`/`SCHOOL_MODE`/`BLOCK_PERIOD` window becomes a
    /// DeviceActivity monitoring interval covering its own active
    /// time-of-day range; cross-midnight windows (end <= start) are
    /// represented as `DateComponents` spanning past midnight, which
    /// `DeviceActivitySchedule` natively supports via
    /// `intervalStart`/`intervalEnd` time-of-day components independent
    /// of calendar day, exactly like `ScheduleEngine.isWindowActive`'s own
    /// cross-midnight handling.
    public static func schedule(for window: ScheduleWindow) -> DeviceActivitySchedule {
        let startComponents = DateComponents(hour: window.start.hour, minute: window.start.minute)
        let endComponents = DateComponents(hour: window.end.hour, minute: window.end.minute)
        // `repeats: true` -- Device Activity re-triggers this schedule every
        // matching day without the host app needing to reschedule daily;
        // day-of-week filtering itself is not a DeviceActivitySchedule
        // primitive, so the monitor extension callback re-checks
        // `window.daysOfWeek` against the current day before applying a
        // shield (see DeviceActivityMonitorExtension.swift) -- the schedule
        // only bounds TIME OF DAY, `ScheduleEngine` remains the single
        // source of truth for whether today counts.
        return DeviceActivitySchedule(intervalStart: startComponents, intervalEnd: endComponents, repeats: true)
    }

    /// Maps a daily app limit into a `DeviceActivityEvent` threshold --
    /// Apple delivers `eventDidReachThreshold` once cumulative usage
    /// within the monitored applications/categories reaches this duration,
    /// which the monitor extension then reconciles against
    /// `ScheduleEngine`'s own remaining-minutes computation (never trusted
    /// as the sole authority, since a threshold event alone cannot express
    /// bonus time/exceptions/precedence -- see doc 07 Section 7).
    public static func thresholdEvent(minutes: Int, applications: Set<ApplicationToken>, categories: Set<ActivityCategoryToken>) -> DeviceActivityEvent {
        DeviceActivityEvent(
            applications: applications,
            categories: categories,
            threshold: DateComponents(minute: minutes)
        )
    }
    #endif
}
