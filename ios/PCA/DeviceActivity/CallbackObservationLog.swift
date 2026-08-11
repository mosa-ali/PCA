import Foundation

/// doc 07 Section 14 / PCA-15 correction F1: real, durable callback
/// recording so `DeviceActivityCallbackReconciler` has something to read
/// on next host-app foreground. Persists ONLY bounded operational
/// metadata (callback kind, activity identifier, event identifier where
/// applicable, timestamp, a local monotonically-increasing sequence
/// number) -- never raw family activity, URLs, private app content, or
/// anything that could deanonymize an opaque FamilyControls token. This
/// file has NO dependency on DeviceActivity/FamilyControls/Security --
/// it is pure Foundation, so its logic is fully unit-testable here.
public struct PersistedCallbackObservation: Codable, Equatable {
    public let kind: DeviceActivityCallbackKind
    public let activityId: String
    public let observedAtUtc: Date
    public let sequence: Int

    public init(kind: DeviceActivityCallbackKind, activityId: String, observedAtUtc: Date, sequence: Int) {
        self.kind = kind
        self.activityId = activityId
        self.observedAtUtc = observedAtUtc
        self.sequence = sequence
    }

    public var asObservedCallback: ObservedCallback {
        ObservedCallback(kind: kind, observedAt: observedAtUtc)
    }
}

public protocol CallbackObservationLog {
    func record(kind: DeviceActivityCallbackKind, activityId: String, at: Date)
    /// Every persisted observation, oldest first. The reconciler consumes
    /// this via `.map(\.asObservedCallback)` -- duplicate/replayed
    /// callbacks (the OS re-delivering the same kind, or a host-app crash
    /// causing a re-record) are simply appended again; reconciliation
    /// stays deterministic because `DeviceActivityCallbackReconciler`
    /// only asks "was this kind observed at all" (a Set membership test),
    /// so any number of duplicates collapses to the same healthy/degraded
    /// verdict.
    func readAll() -> [PersistedCallbackObservation]
}

/// doc 07 Section 14's reconciliation needs bounded history, not
/// unbounded growth -- same resource-abuse-ceiling rationale as the
/// backend's replay/idempotency ledgers (backend/src/familyenvelope/policy.ts).
public let callbackObservationLogCapacity = 500

/// App-Group `UserDefaults`-backed conformance -- the DeviceActivityMonitor
/// extension and the host app both read/write the SAME log via the shared
/// App Group container (extensions run out-of-process, doc 07 Section 7),
/// exactly the mechanism `AppGroupBlobStore` already establishes for
/// `FamilyActivitySelectionStore`.
public final class AppGroupCallbackObservationLog: CallbackObservationLog {
    public enum StoreError: Error { case appGroupUnavailable }

    private let defaults: UserDefaults
    private let storageKey: String
    private let capacity: Int
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    public init(appGroupIdentifier: String, storageKey: String = "com.pca.app.deviceactivity.callbacklog", capacity: Int = callbackObservationLogCapacity) throws {
        guard let defaults = UserDefaults(suiteName: appGroupIdentifier) else {
            throw StoreError.appGroupUnavailable
        }
        self.defaults = defaults
        self.storageKey = storageKey
        self.capacity = capacity
    }

    public func record(kind: DeviceActivityCallbackKind, activityId: String, at: Date) {
        var all = readAll()
        let nextSequence = (all.last?.sequence ?? 0) + 1
        all.append(PersistedCallbackObservation(kind: kind, activityId: activityId, observedAtUtc: at, sequence: nextSequence))
        // Bounded: evict oldest once over capacity -- a resource ceiling,
        // never a correctness control (reconciliation only needs recent
        // history relative to the current schedule's own expectations).
        if all.count > capacity {
            all.removeFirst(all.count - capacity)
        }
        guard let data = try? encoder.encode(all) else { return }
        defaults.set(data, forKey: storageKey)
    }

    public func readAll() -> [PersistedCallbackObservation] {
        guard let data = defaults.data(forKey: storageKey) else { return [] }
        return (try? decoder.decode([PersistedCallbackObservation].self, from: data)) ?? []
    }
}

/// In-memory conformance for tests/previews -- never used by a shipping
/// extension (which needs cross-process persistence via the App Group).
public final class InMemoryCallbackObservationLog: CallbackObservationLog {
    private var observations: [PersistedCallbackObservation] = []
    private let capacity: Int

    public init(capacity: Int = callbackObservationLogCapacity) {
        self.capacity = capacity
    }

    public func record(kind: DeviceActivityCallbackKind, activityId: String, at: Date) {
        let nextSequence = (observations.last?.sequence ?? 0) + 1
        observations.append(PersistedCallbackObservation(kind: kind, activityId: activityId, observedAtUtc: at, sequence: nextSequence))
        if observations.count > capacity {
            observations.removeFirst(observations.count - capacity)
        }
    }

    public func readAll() -> [PersistedCallbackObservation] {
        observations
    }
}
