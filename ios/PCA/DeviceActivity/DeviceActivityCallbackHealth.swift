import Foundation

/// A monitor callback can arrive after Family Controls authorization was
/// revoked. The host clears its own shields when it observes that transition;
/// this shared gate gives the out-of-process monitor the same fail-closed
/// behavior before it evaluates or reapplies a stored policy.
public enum DeviceActivityCallbackAuthorization: Equatable {
    case approved
    case denied
    case notDetermined
    case unavailable
}

public enum DeviceActivityCallbackAuthorizationAction: Equatable {
    case applyCurrentPolicy
    case clearShieldsPreservingPolicy
}

public enum DeviceActivityAuthorizationGate {
    /// Only approved authorization may evaluate/apply policy. Every other
    /// status clears the current shield but retains stored policy for recovery.
    public static func action(for status: DeviceActivityCallbackAuthorization) -> DeviceActivityCallbackAuthorizationAction {
        status == .approved ? .applyCurrentPolicy : .clearShieldsPreservingPolicy
    }
}

/// Foundation-only callback delivery evidence. Apple delivers interval
/// callbacks when the device is used, and does not supply a recurrence ID.
/// Absence therefore cannot prove missed delivery. Only a receipt attributable
/// to the first occurrence of a unique installation can certify delivery;
/// later recurring occurrences and absent/ambiguous evidence remain unknown.
public enum DeviceActivityCallbackKind: Equatable, Hashable, Codable {
    case intervalDidStart
    case intervalDidEnd
    case eventDidReachThreshold(eventId: String)
}

public struct ObservedCallback: Equatable {
    public let kind: DeviceActivityCallbackKind
    public let observedAt: Date
    public let activityId: String?
    public let installationGeneration: String?

    public init(
        kind: DeviceActivityCallbackKind,
        observedAt: Date,
        activityId: String? = nil,
        installationGeneration: String? = nil
    ) {
        self.kind = kind
        self.observedAt = observedAt
        self.activityId = activityId
        self.installationGeneration = installationGeneration
    }
}

public struct ExpectedCallback: Equatable {
    public let kind: DeviceActivityCallbackKind
    /// The schedule boundary for this specific daily occurrence. An observation
    /// can satisfy this occurrence only if it was recorded at or after it.
    public let occurrenceAt: Date
    public let observationWindowEndsAt: Date?
    public let attributionIsUnambiguous: Bool

    public init(kind: DeviceActivityCallbackKind, occurrenceAt: Date, observationWindowEndsAt: Date? = nil, attributionIsUnambiguous: Bool = false) {
        self.kind = kind
        self.occurrenceAt = occurrenceAt
        self.observationWindowEndsAt = observationWindowEndsAt
        self.attributionIsUnambiguous = attributionIsUnambiguous
    }
}

public enum DeviceActivityCallbackHealth: Equatable {
    /// Every due, unambiguous first-install occurrence has a matching receipt.
    case healthy
    /// A separately proven delivery failure. Absence alone cannot establish
    /// this because Apple's callbacks depend on qualifying device use.
    case degraded(missed: [ExpectedCallback])
    /// No due expectation, missing receipt or ambiguous recurrence provenance.
    case unknown
}

private func isValidCallbackTolerance(_ seconds: TimeInterval) -> Bool {
    seconds.isFinite && seconds >= 0
}

public enum DeviceActivityCallbackReconciler {
    /// The grace delays assessment; it is not an Apple delivery SLA. Missing
    /// receipts and repeated occurrences without OS occurrence identity remain
    /// unknown. First-install receipts can be attributed only before the next
    /// same-kind schedule boundary, even if device use delays delivery.
    public static func reconcile(
        expected: [ExpectedCallback],
        observed: [ObservedCallback],
        activityId: String,
        installationGeneration: String,
        nowUtc: Date,
        toleranceSeconds: TimeInterval = 120
    ) -> DeviceActivityCallbackHealth {
        guard isValidCallbackTolerance(toleranceSeconds) else { return .unknown }
        let dueExpectations = expected.filter { nowUtc.timeIntervalSince($0.occurrenceAt) > toleranceSeconds }
        if dueExpectations.isEmpty {
            // Not just "no expectations at all" -- also "expectations exist but
            // none has come due yet" (including ones still inside the jitter
            // tolerance window). Neither healthy nor degraded is assertable
            // yet in either case (see this type's own doc comment on .unknown).
            return .unknown
        }
        let matched = dueExpectations.allSatisfy { expectation in
            guard expectation.attributionIsUnambiguous,
                  let windowEnd = expectation.observationWindowEndsAt else { return false }
            return observed.contains { callback in
                callback.activityId == activityId &&
                callback.installationGeneration == installationGeneration &&
                callback.kind == expectation.kind &&
                callback.observedAt >= expectation.occurrenceAt &&
                callback.observedAt < windowEnd &&
                callback.observedAt <= nowUtc
            }
        }
        return matched ? .healthy : .unknown
    }
}

/// Builds expectations for the current or most recently completed daily
/// occurrence of the technical 00:00–23:59 monitoring envelope. The policy's
/// own timezone is deliberately not involved: the monitoring calendar and its
/// timezone are captured when DeviceActivity is installed.
public enum DeviceActivityCallbackPlanner {
    public static func expectedCallbacks(
        installedAt: Date,
        now: Date,
        calendar: Calendar,
        toleranceSeconds: TimeInterval = 120
    ) -> [ExpectedCallback] {
        guard isValidCallbackTolerance(toleranceSeconds) else { return [] }
        let todayStart = calendar.startOfDay(for: now)
        guard let tomorrowStart = calendar.date(byAdding: .day, value: 1, to: todayStart),
              let todayEnd = calendar.date(bySettingHour: 23, minute: 59, second: 0, of: todayStart),
              let yesterdayStart = calendar.date(byAdding: .day, value: -1, to: todayStart),
              let yesterdayEnd = calendar.date(bySettingHour: 23, minute: 59, second: 0, of: yesterdayStart) else {
            return []
        }

        let installationDay = calendar.startOfDay(for: installedAt)
        guard let installationDayEnd = calendar.date(bySettingHour: 23, minute: 59, second: 0, of: installationDay),
              let nextInstallationDay = calendar.date(byAdding: .day, value: 1, to: installationDay),
              let nextInstallationDayEnd = calendar.date(bySettingHour: 23, minute: 59, second: 0, of: nextInstallationDay) else { return [] }
        let firstStart = installedAt < installationDayEnd ? installedAt : nextInstallationDay
        let firstEnd = installedAt < installationDayEnd ? installationDayEnd : nextInstallationDayEnd

        var expected: [ExpectedCallback] = []
        let todayStartOccurrence: Date
        if installedAt >= todayStart && installedAt < todayEnd {
            // Apple can deliver intervalDidStart immediately when monitoring
            // begins while the current interval is already active.
            todayStartOccurrence = installedAt
        } else if installedAt < todayStart {
            todayStartOccurrence = todayStart
        } else {
            // Installation after the 23:59 end boundary waits for tomorrow's
            // next interval start.
            todayStartOccurrence = tomorrowStart
        }
        if todayStartOccurrence <= now {
            expected.append(ExpectedCallback(kind: .intervalDidStart, occurrenceAt: todayStartOccurrence, observationWindowEndsAt: tomorrowStart, attributionIsUnambiguous: todayStartOccurrence == firstStart))
        }

        let latestEnd = now.timeIntervalSince(todayEnd) > toleranceSeconds ? todayEnd : yesterdayEnd
        if now.timeIntervalSince(latestEnd) > toleranceSeconds && installedAt < latestEnd,
           let nextEnd = calendar.date(byAdding: .day, value: 1, to: latestEnd) {
            expected.append(ExpectedCallback(kind: .intervalDidEnd, occurrenceAt: latestEnd, observationWindowEndsAt: nextEnd, attributionIsUnambiguous: latestEnd == firstEnd))
        }
        return expected
    }
}
