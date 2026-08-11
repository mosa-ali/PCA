import Foundation

/// doc 07 Section 14: "`DeviceActivityMonitor` extension fails to receive
/// scheduled callback (OS resource constraints) -- Missed-callback
/// detection via expected-vs-actual schedule reconciliation on next
/// host-app foreground -- Treated as a degraded-signal event ... not
/// silently reported as full compliance."
///
/// Pure logic, framework-independent: the monitor extension (or the host
/// app on foreground) records each callback kind it actually observed
/// with a timestamp; this type compares that log against what the
/// SCHEDULE said should have fired by `nowUtc` and reports health.
public enum DeviceActivityCallbackKind: Equatable, Hashable {
    case intervalDidStart
    case intervalDidEnd
    case eventDidReachThreshold(eventId: String)
}

public struct ObservedCallback: Equatable {
    public let kind: DeviceActivityCallbackKind
    public let observedAt: Date
    public init(kind: DeviceActivityCallbackKind, observedAt: Date) {
        self.kind = kind
        self.observedAt = observedAt
    }
}

public struct ExpectedCallback: Equatable {
    public let kind: DeviceActivityCallbackKind
    public let expectedNoLaterThan: Date
    public init(kind: DeviceActivityCallbackKind, expectedNoLaterThan: Date) {
        self.kind = kind
        self.expectedNoLaterThan = expectedNoLaterThan
    }
}

public enum DeviceActivityCallbackHealth: Equatable {
    /// Every expected callback (whose deadline has passed) has a matching observed entry.
    case healthy
    /// At least one expected callback's deadline has passed with no matching observation --
    /// this is DEGRADED, never silently treated as "still fully enforced."
    case degraded(missed: [ExpectedCallback])
    /// No expectation has come due yet -- neither healthy nor degraded is assertable.
    case unknown
}

public enum DeviceActivityCallbackReconciler {
    /// `toleranceSeconds` allows for ordinary OS scheduling jitter without
    /// flagging every callback as "missed" the instant its nominal deadline
    /// passes -- a real miss (OS resource throttling, extension not
    /// launched) is on the order of minutes to indefinitely, not seconds.
    public static func reconcile(expected: [ExpectedCallback], observed: [ObservedCallback], nowUtc: Date, toleranceSeconds: TimeInterval = 120) -> DeviceActivityCallbackHealth {
        let dueExpectations = expected.filter { nowUtc.timeIntervalSince($0.expectedNoLaterThan) > toleranceSeconds }
        if dueExpectations.isEmpty {
            return expected.isEmpty ? .unknown : .healthy
        }
        let observedKinds = Set(observed.map(\.kind))
        let missed = dueExpectations.filter { !observedKinds.contains($0.kind) }
        return missed.isEmpty ? .healthy : .degraded(missed: missed)
    }
}
