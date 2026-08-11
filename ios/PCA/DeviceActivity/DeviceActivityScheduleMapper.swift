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
public enum DeviceActivityScheduleMapper {
    #if canImport(DeviceActivity)
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
