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
    /// The generation is absent in legacy observations and for callbacks from
    /// monitors that are no longer the active installation. Such records are
    /// retained for bounded diagnostics but cannot establish callback health.
    public let installationGeneration: String?
    public let observedAtUtc: Date
    public let sequence: Int

    public init(
        kind: DeviceActivityCallbackKind,
        activityId: String,
        installationGeneration: String? = nil,
        observedAtUtc: Date,
        sequence: Int
    ) {
        self.kind = kind
        self.activityId = activityId
        self.installationGeneration = installationGeneration
        self.observedAtUtc = observedAtUtc
        self.sequence = sequence
    }

    public var asObservedCallback: ObservedCallback {
        ObservedCallback(
            kind: kind,
            observedAt: observedAtUtc,
            activityId: activityId,
            installationGeneration: installationGeneration
        )
    }
}

public enum DeviceActivityMonitorInstallationState: String, Codable {
    case starting
    case active
    case invalidated
}

/// App Group record shared by the host and DeviceActivity extension. Each
/// installation receives a distinct monitor activity name, so a callback
/// delivered late by a previous schedule can never be relabeled as belonging
/// to the new installation merely because both protect the same policy.
/// Reevaluation opportunities only; ScheduleEngine owns every decision.
public enum DeviceActivityBoundaryTrigger: Codable, Equatable, Hashable {
    case recurring(timeZoneIdentifier: String, hour: Int, minute: Int)
    case absolute(utc: Date)

    public var isValid: Bool {
        switch self {
        case let .recurring(zone, hour, minute):
            return TimeZone(identifier: zone) != nil && (0...23).contains(hour) && (0...59).contains(minute)
        case let .absolute(date):
            return date.timeIntervalSince1970.isFinite && (-62135596800...253402257599).contains(date.timeIntervalSince1970)
        }
    }
}

public struct DeviceActivityBoundaryMonitor: Codable, Equatable {
    public let activityId: String
    public let trigger: DeviceActivityBoundaryTrigger
    public init(activityId: String, trigger: DeviceActivityBoundaryTrigger) {
        self.activityId = activityId
        self.trigger = trigger
    }
}

public struct DeviceActivityMonitorInstallation: Codable, Equatable {
    public let policyActivityId: String
    public let monitorActivityId: String
    public let generation: String
    public let installedAtUtc: Date
    public let timeZoneIdentifier: String
    public let state: DeviceActivityMonitorInstallationState
    public let schemaVersion: Int?
    public let boundaryMonitors: [DeviceActivityBoundaryMonitor]?

    public init(
        policyActivityId: String,
        monitorActivityId: String,
        generation: String,
        installedAtUtc: Date,
        timeZoneIdentifier: String,
        state: DeviceActivityMonitorInstallationState,
        schemaVersion: Int? = nil,
        boundaryMonitors: [DeviceActivityBoundaryMonitor]? = nil
    ) {
        self.policyActivityId = policyActivityId
        self.monitorActivityId = monitorActivityId
        self.generation = generation
        self.installedAtUtc = installedAtUtc
        self.timeZoneIdentifier = timeZoneIdentifier
        self.state = state
        self.schemaVersion = schemaVersion
        self.boundaryMonitors = boundaryMonitors
    }

    public func confirmingActive() -> DeviceActivityMonitorInstallation {
        DeviceActivityMonitorInstallation(
            policyActivityId: policyActivityId,
            monitorActivityId: monitorActivityId,
            generation: generation,
            installedAtUtc: installedAtUtc,
            timeZoneIdentifier: timeZoneIdentifier,
            state: .active,
            schemaVersion: schemaVersion,
            boundaryMonitors: boundaryMonitors
        )
    }

    public func invalidating() -> DeviceActivityMonitorInstallation {
        DeviceActivityMonitorInstallation(policyActivityId: policyActivityId, monitorActivityId: monitorActivityId, generation: generation, installedAtUtc: installedAtUtc, timeZoneIdentifier: timeZoneIdentifier, state: .invalidated, schemaVersion: schemaVersion, boundaryMonitors: boundaryMonitors)
    }

    public var allMonitorActivityIds: [String] {
        [monitorActivityId] + (boundaryMonitors ?? []).map(\.activityId)
    }

    public var payloadStorageGeneration: String? { schemaVersion == 2 ? generation : nil }

    public func containsMonitor(_ id: String) -> Bool { allMonitorActivityIds.contains(id) }

    public static func decodeValidated(_ data: Data) -> DeviceActivityMonitorInstallation? {
        guard let value = try? JSONDecoder().decode(Self.self, from: data),
              !value.policyActivityId.isEmpty,
              value.monitorActivityId.hasPrefix("pca-monitor-"),
              UUID(uuidString: String(value.monitorActivityId.dropFirst("pca-monitor-".count))) != nil,
              UUID(uuidString: value.generation) != nil,
              value.installedAtUtc.timeIntervalSince1970.isFinite,
              TimeZone(identifier: value.timeZoneIdentifier) != nil else { return nil }
        guard value.schemaVersion == nil || value.schemaVersion == 2 else { return nil }
        if value.schemaVersion == 2 {
            guard let boundaries = value.boundaryMonitors, boundaries.count <= 19,
                  boundaries.allSatisfy({ $0.trigger.isValid }),
                  Set(boundaries.map(\.trigger)).count == boundaries.count else { return nil }
        } else if value.boundaryMonitors != nil { return nil }
        let ids = value.allMonitorActivityIds
        guard Set(ids).count == ids.count,
              ids.allSatisfy({ $0.hasPrefix("pca-monitor-") && UUID(uuidString: String($0.dropFirst("pca-monitor-".count))) != nil }) else { return nil }
        return value
    }
}

public let deviceActivityMonitorInstallationStorageKey = "com.pca.app.deviceactivity.installation.v1"

public protocol CallbackObservationLog {
    func record(kind: DeviceActivityCallbackKind, activityId: String, at: Date)
    /// Every persisted observation, oldest first. Duplicates remain
    /// distinguishable by their timestamp, activity name and installation
    /// generation so each can satisfy only its matching schedule occurrence.
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
    private let installationStorageKey: String
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()
    private let installationReader: (() -> Data?)?

    public init(
        appGroupIdentifier: String,
        storageKey: String = "com.pca.app.deviceactivity.callbacklog",
        installationStorageKey: String = deviceActivityMonitorInstallationStorageKey,
        capacity: Int = callbackObservationLogCapacity,
        installationReader: (() -> Data?)? = nil
    ) throws {
        guard let defaults = UserDefaults(suiteName: appGroupIdentifier) else {
            throw StoreError.appGroupUnavailable
        }
        self.defaults = defaults
        self.storageKey = storageKey
        self.installationStorageKey = installationStorageKey
        self.capacity = capacity
        self.installationReader = installationReader
    }

    public func record(kind: DeviceActivityCallbackKind, activityId: String, at: Date) {
        let installationData: Data?
        if let reader = installationReader { installationData = reader() }
        else { installationData = defaults.data(forKey: installationStorageKey) }
        let installation = installationData
            .flatMap { DeviceActivityMonitorInstallation.decodeValidated($0) }
        // Auxiliary/stale callback traffic has its own bounded diagnostics
        // ring and cannot evict the technical anchor's health observations.
        let targetKey = installation.map { $0.monitorActivityId == activityId ? storageKey : storageKey + ".boundaries" } ?? storageKey
        var all = readRecords(forKey: targetKey)
        let nextSequence = (all.last?.sequence ?? 0) + 1
        let installationGeneration = installation.flatMap { $0.containsMonitor(activityId) ? $0.generation : nil }
        all.append(PersistedCallbackObservation(
            kind: kind,
            activityId: activityId,
            installationGeneration: installationGeneration,
            observedAtUtc: at,
            sequence: nextSequence
        ))
        // Bounded: evict oldest once over capacity -- a resource ceiling,
        // never a correctness control (reconciliation only needs recent
        // history relative to the current schedule's own expectations).
        if all.count > capacity {
            all.removeFirst(all.count - capacity)
        }
        guard let data = try? encoder.encode(all) else { return }
        defaults.set(data, forKey: targetKey)
    }

    public func readAll() -> [PersistedCallbackObservation] { readRecords(forKey: storageKey) }

    private func readRecords(forKey key: String) -> [PersistedCallbackObservation] {
        guard let data = defaults.data(forKey: key) else { return [] }
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

/// Serializes host replacement and extension decision/shield mutation across
/// processes. Lock failure preserves existing shields; it has no local fallback.
public protocol DeviceActivityPolicyCoordination {
    func withExclusiveAccess<T>(_ operation: () throws -> T) throws -> T
}
public final class LocalDeviceActivityPolicyCoordination: DeviceActivityPolicyCoordination {
    private let lock = NSRecursiveLock()
    public init() {}
    public func withExclusiveAccess<T>(_ operation: () throws -> T) throws -> T {
        lock.lock(); defer { lock.unlock() }; return try operation()
    }
}
#if canImport(Darwin)
import Darwin
import func Darwin.flock

// Scoped import plus an explicit function type excludes Darwin.flock the
// record-lock structure from Swift overload resolution.
private let deviceActivitySystemFlock: (Int32, Int32) -> Int32 = flock
public enum DeviceActivityPolicyStorageError: Error { case appGroupUnavailable, lockUnavailable }
public final class AppGroupDeviceActivityPolicyCoordination: DeviceActivityPolicyCoordination {
    private let path: String
    public init(appGroupIdentifier: String) throws {
        guard let url = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroupIdentifier) else {
            throw DeviceActivityPolicyStorageError.appGroupUnavailable
        }
        path = url.appendingPathComponent("device-activity-policy.lock").path
    }
    public init(lockFile: URL) { path = lockFile.path }
    public func withExclusiveAccess<T>(_ operation: () throws -> T) throws -> T {
        let fd = path.withCString { Darwin.open($0, O_CREAT | O_RDWR | O_CLOEXEC, mode_t(0o600)) }
        guard fd >= 0 else { throw DeviceActivityPolicyStorageError.lockUnavailable }
        defer { Darwin.close(fd) }
        while deviceActivitySystemFlock(fd, LOCK_EX) != 0 {
            if errno != EINTR { throw DeviceActivityPolicyStorageError.lockUnavailable }
        }
        defer { deviceActivitySystemFlock(fd, LOCK_UN) }
        return try operation()
    }
}

/// File-backed policy state avoids UserDefaults cache visibility races under
/// the shared process lock. Old defaults are read only before the first file
/// mutation; a permanent marker prevents deleted/corrupt new state falling
/// back to an older legacy installation. No wildcard deletion or data seeding.
public final class AppGroupDeviceActivityFileStore: OpaqueBlobStore {
    private let directory: URL
    private let marker: URL
    private let legacy: OpaqueBlobStore
    public convenience init(appGroupIdentifier: String) throws {
        guard let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroupIdentifier) else {
            throw DeviceActivityPolicyStorageError.appGroupUnavailable
        }
        try self.init(directory: container.appendingPathComponent("device-activity-policy-v2", isDirectory: true), legacyStore: AppGroupBlobStore(appGroupIdentifier: appGroupIdentifier))
    }
    public init(directory: URL, legacyStore: OpaqueBlobStore) throws {
        self.directory = directory
        self.marker = directory.appendingPathComponent("file-storage-owner")
        self.legacy = legacyStore
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }
    private func url(for key: String) -> URL {
        let name = Data(key.utf8).base64EncodedString().replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "+", with: "-")
        return directory.appendingPathComponent(name)
    }
    public func write(_ data: Data, forKey key: String) throws {
        try Data("2".utf8).write(to: marker, options: .atomic)
        try data.write(to: url(for: key), options: .atomic)
    }
    public func read(forKey key: String) -> Data? {
        if FileManager.default.fileExists(atPath: marker.path) {
            return try? Data(contentsOf: url(for: key))
        }
        return legacy.read(forKey: key)
    }
    public func remove(forKey key: String) {
        // A failed marker write must not authorize a legacy fallback removal.
        do { try Data("2".utf8).write(to: marker, options: .atomic) }
        catch { return }
        try? FileManager.default.removeItem(at: url(for: key))
        legacy.remove(forKey: key)
    }
}
#endif
