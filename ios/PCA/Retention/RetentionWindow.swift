import Foundation

/// iOS-side mirror of backend/src/retention/policy.ts + calendar.ts
/// (PCA-12). Same five supported windows, same "14 days is exact UTC
/// elapsed, calendar months are computed in the family's policy time
/// zone" rule (doc 11 Section 2/5.1) -- the device runs its OWN local
/// deletion cycle against its own local vault (doc 11 Section 5.2), so
/// this logic must be genuinely present on-device, not merely delegated
/// to the backend.
public enum RetentionWindow: Equatable {
    case fourteenDays
    case oneMonth
    case threeMonths
    case sixMonths
    case nineMonths

    var months: Int? {
        switch self {
        case .fourteenDays: return nil
        case .oneMonth: return 1
        case .threeMonths: return 3
        case .sixMonths: return 6
        case .nineMonths: return 9
        }
    }
}

public enum RetentionExpiryCalculator {
    public static func expiryInstant(eventTimestampUtc: Date, timeZone: TimeZone, window: RetentionWindow) -> Date {
        if window == .fourteenDays {
            return eventTimestampUtc.addingTimeInterval(14 * 24 * 60 * 60)
        }
        guard let months = window.months else { return eventTimestampUtc }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        // `Calendar.date(byAdding:)` performs genuine calendar-month
        // arithmetic (correct days-in-month, leap years) and is DST-safe
        // by construction, since it operates on `DateComponents` resolved
        // against the supplied time zone rather than a fixed offset --
        // the same guarantee backend/src/retention/calendar.ts achieves
        // via its own ICU-backed iterative resolver, here provided
        // natively by Foundation.
        return calendar.date(byAdding: .month, value: months, to: eventTimestampUtc) ?? eventTimestampUtc
    }

    public static func isExpired(eventTimestampUtc: Date, timeZone: TimeZone, window: RetentionWindow, nowUtc: Date) -> Bool {
        nowUtc >= expiryInstant(eventTimestampUtc: eventTimestampUtc, timeZone: timeZone, window: window)
    }
}
