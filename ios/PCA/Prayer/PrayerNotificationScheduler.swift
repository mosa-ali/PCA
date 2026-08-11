import Foundation
#if canImport(UserNotifications)
import UserNotifications
#endif

/// PCA-9 iOS adapter (doc 17). Local notifications only -- a scheduled
/// `UNNotificationRequest` is the reliable baseline; exact-time audio
/// playback (e.g. Adhan) at a precise background instant is subject to
/// iOS background-execution limits and is explicitly NOT guaranteed here
/// (doc 07's platform-honesty discipline applied to doc 17's own
/// `VERIFIED_WITH_LIMITATION` labeling -- background audio at a precise
/// scheduled time is best-effort, never promised).
public struct PrayerReminderRequest: Equatable {
    public let id: String
    public let fireDate: Date
    public let title: String
    public let body: String
    public init(id: String, fireDate: Date, title: String, body: String) {
        self.id = id; self.fireDate = fireDate; self.title = title; self.body = body
    }
}

public enum PrayerSchedulingOutcome: Equatable {
    case scheduled
    /// The fire date is already in the past -- never silently scheduled
    /// (which would either never fire or fire immediately/incorrectly).
    case rejectedPastFireDate
}

public enum PrayerNotificationScheduling {
    public static func validate(_ request: PrayerReminderRequest, nowUtc: Date) -> PrayerSchedulingOutcome {
        request.fireDate > nowUtc ? .scheduled : .rejectedPastFireDate
    }

    #if canImport(UserNotifications)
    public static func makeRequest(from reminder: PrayerReminderRequest) -> UNNotificationRequest {
        let content = UNMutableNotificationContent()
        content.title = reminder.title
        content.body = reminder.body
        content.sound = .default // system default sound only -- no custom Adhan audio claim of precise-time reliability here

        let components = Calendar(identifier: .gregorian).dateComponents([.year, .month, .day, .hour, .minute, .second], from: reminder.fireDate)
        let trigger = UNCalendarNotificationTrigger(dateMatching: components, repeats: false)
        return UNNotificationRequest(identifier: reminder.id, content: content, trigger: trigger)
    }
    #endif
}
