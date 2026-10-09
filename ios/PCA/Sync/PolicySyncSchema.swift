import Foundation

/// doc 07 Section 6/12, PCA-15 correction F1: the on-device wire shape for
/// a decoded, ALREADY-VERIFIED PCA-4 schedule policy as synced into the
/// App Group container for the DeviceActivityMonitor extension to read.
/// This module NEVER re-verifies signatures/epochs itself (that already
/// happened upstream, at the point the family envelope was accepted --
/// backend/src/familyenvelope, consumed not reimplemented) -- it owns
/// exactly one thing: decoding the stored bytes into `ScheduleWindow`/etc.
/// SAFELY, rejecting anything malformed rather than guessing, and
/// stamping/checking a schema version so an old extension binary can
/// never silently misinterpret a newer host app's payload shape (or vice
/// versa) as if it succeeded.
///
/// Pure Foundation -- no FamilyControls/DeviceActivity/Security import --
/// so this decode/validate logic is fully unit-testable without any
/// Apple-only framework.
public let policySyncSchemaVersion = 1

/// Shared host/extension reload boundary. Present corrupt safety-floor data
/// is unavailable, never an empty floor; schedule identity is key-bound.
public struct StoredDeviceActivityPolicySnapshot<Token: Hashable & Codable> {
    public let schedule: DecodedSchedulePolicy
    public let applicationTokens: Set<Token>
    public let protectedApplicationTokens: Set<Token>
}

public struct StoredDeviceActivityPolicyLoader<Token: Hashable & Codable> {
    private let scheduleStore: OpaqueBlobStore
    private let tokenStore: OpaqueBlobStore

    public init(scheduleStore: OpaqueBlobStore, tokenStore: OpaqueBlobStore) {
        self.scheduleStore = scheduleStore
        self.tokenStore = tokenStore
    }

    public func load(activityId: String, storageGeneration: String? = nil) -> StoredDeviceActivityPolicySnapshot<Token>? {
        if let generation = storageGeneration, UUID(uuidString: generation) == nil { return nil }
        let suffix = storageGeneration.map { "." + $0 } ?? ""
        guard let scheduleData = scheduleStore.read(forKey: "schedule.\(activityId)\(suffix)"),
              case .success(let schedule) = PolicySyncDecoder.decode(scheduleData),
              schedule.activityId.utf8.elementsEqual(activityId.utf8),
              let tokenData = tokenStore.read(forKey: "applicationTokens.\(activityId)\(suffix)"),
              let tokens = try? PropertyListDecoder().decode(Set<Token>.self, from: tokenData) else { return nil }
        let protectedTokens: Set<Token>
        if let data = tokenStore.read(forKey: "protectedApplicationTokens\(suffix)") {
            guard let decoded = try? PropertyListDecoder().decode(Set<Token>.self, from: data) else { return nil }
            protectedTokens = decoded
        } else {
            guard storageGeneration == nil else { return nil }
            protectedTokens = []
        }
        return StoredDeviceActivityPolicySnapshot(
            schedule: schedule, applicationTokens: tokens, protectedApplicationTokens: protectedTokens
        )
    }
}

/// The installation manifest is the single durable publication point shared
/// by the host and extension. `activeActivityId` is a repairable compatibility
/// pointer and cannot override a committed manifest after a process restart.
/// A present malformed/starting installation never downgrades to legacy slots.
public struct InstalledDeviceActivityPolicyLoader<Token: Hashable & Codable> {
    private let scheduleStore: OpaqueBlobStore
    private let tokenStore: OpaqueBlobStore
    public init(scheduleStore: OpaqueBlobStore, tokenStore: OpaqueBlobStore) {
        self.scheduleStore = scheduleStore; self.tokenStore = tokenStore
    }
    public func load(monitorActivityId: String) -> StoredDeviceActivityPolicySnapshot<Token>? {
        let loader = StoredDeviceActivityPolicyLoader<Token>(scheduleStore: scheduleStore, tokenStore: tokenStore)
        if let data = scheduleStore.read(forKey: deviceActivityMonitorInstallationStorageKey) {
            guard let installation = DeviceActivityMonitorInstallation.decodeValidated(data),
                  installation.state == .active,
                  installation.containsMonitor(monitorActivityId),
                  let snapshot = loader.load(activityId: installation.policyActivityId, storageGeneration: installation.payloadStorageGeneration),
                  scheduleStore.read(forKey: deviceActivityMonitorInstallationStorageKey) == data else { return nil }
            return snapshot
        }
        guard scheduleStore.read(forKey: "activeActivityId") == Data(monitorActivityId.utf8) else { return nil }
        return loader.load(activityId: monitorActivityId)
    }
}

public struct StoredTimeOfDay: Codable, Equatable {
    public let hour: Int
    public let minute: Int
    public init(hour: Int, minute: Int) { self.hour = hour; self.minute = minute }
}

public enum StoredAppScope: Codable, Equatable {
    case all
    case apps([String])

    public static func == (lhs: Self, rhs: Self) -> Bool {
        switch (lhs, rhs) {
        case (.all, .all): return true
        case (.apps(let a), .apps(let b)): return Set(a.map { Data($0.utf8) }) == Set(b.map { Data($0.utf8) })
        default: return false
        }
    }
}

public struct StoredScheduleWindow: Codable, Equatable {
    /// Optional only for legacy stored snapshots. New explicit per-window
    /// timezone uses the shared policy field name; malformed zones reject.
    public let timezone: String?
    public let id: String
    public let kind: ScheduleWindowKind
    public let daysOfWeek: Set<Int>
    public let start: StoredTimeOfDay
    public let end: StoredTimeOfDay
    public let appScope: StoredAppScope

    public init(id: String, kind: ScheduleWindowKind, daysOfWeek: Set<Int>, start: StoredTimeOfDay, end: StoredTimeOfDay, appScope: StoredAppScope, timezone: String? = nil) {
        self.timezone = timezone
        self.id = id; self.kind = kind; self.daysOfWeek = daysOfWeek; self.start = start; self.end = end; self.appScope = appScope
    }
}

public struct StoredBonusGrant: Codable, Equatable {
    public let id: String
    public let appScope: StoredAppScope
    public let extraMinutes: Int
    public let grantedAtUtc: Date
    public let expiresAtUtc: Date
    public init(id: String, appScope: StoredAppScope, extraMinutes: Int, grantedAtUtc: Date, expiresAtUtc: Date) {
        self.id = id; self.appScope = appScope; self.extraMinutes = extraMinutes; self.grantedAtUtc = grantedAtUtc; self.expiresAtUtc = expiresAtUtc
    }
}

public struct StoredParentException: Codable, Equatable {
    public let id: String
    public let appScope: StoredAppScope
    public let startAtUtc: Date
    public let endAtUtc: Date
    public init(id: String, appScope: StoredAppScope, startAtUtc: Date, endAtUtc: Date) {
        self.id = id; self.appScope = appScope; self.startAtUtc = startAtUtc; self.endAtUtc = endAtUtc
    }
}

public struct StoredDailyAppLimit: Codable, Equatable {
    public let appScope: StoredAppScope
    public let limitMinutes: Int
    public let usedMinutesToday: Int
    public let anchorLocalDate: String
    public init(appScope: StoredAppScope, limitMinutes: Int, usedMinutesToday: Int, anchorLocalDate: String) {
        self.appScope = appScope; self.limitMinutes = limitMinutes; self.usedMinutesToday = usedMinutesToday; self.anchorLocalDate = anchorLocalDate
    }
}

public enum StoredEnforcementCapability: String, Codable, Equatable {
    case enforced, degraded, unavailable
}

/// The full stored payload for one monitored activity. `schemaVersion`
/// MUST equal `policySyncSchemaVersion` or the whole payload is rejected
/// (PCA-15 correction F1: "validate schema/version ... fail safely on
/// malformed data").
public struct StoredDeviceActivityPolicy: Codable, Equatable {
    public let schemaVersion: Int
    public let activityId: String
    public let appToken: String
    public let timeZoneIdentifier: String
    public let windows: [StoredScheduleWindow]
    public let bonusGrants: [StoredBonusGrant]
    public let exceptions: [StoredParentException]
    public let dailyLimit: StoredDailyAppLimit?
    public let enforcementCapability: StoredEnforcementCapability

    public init(
        schemaVersion: Int, activityId: String, appToken: String, timeZoneIdentifier: String,
        windows: [StoredScheduleWindow], bonusGrants: [StoredBonusGrant], exceptions: [StoredParentException],
        dailyLimit: StoredDailyAppLimit?, enforcementCapability: StoredEnforcementCapability
    ) {
        self.schemaVersion = schemaVersion; self.activityId = activityId; self.appToken = appToken
        self.timeZoneIdentifier = timeZoneIdentifier; self.windows = windows; self.bonusGrants = bonusGrants
        self.exceptions = exceptions; self.dailyLimit = dailyLimit; self.enforcementCapability = enforcementCapability
    }
}

/// A fully decoded and validated in-memory schedule -- the domain shape
/// `ScheduleEngine.evaluate` actually consumes, assembled only after every
/// structural/schema check below has passed.
public struct DecodedSchedulePolicy: Equatable {
    public let activityId: String
    public let appToken: String
    public let timeZone: TimeZone
    public let windows: [ScheduleWindow]
    public let bonusGrants: [BonusGrant]
    public let exceptions: [ParentException]
    public let dailyLimit: DailyAppLimit?
    public let enforcementCapability: EnforcementCapabilityState
}

public enum PolicySyncDecodeError: Error, Equatable {
    case malformedData
    case unsupportedSchemaVersion(found: Int, expected: Int)
    case unrecognizedTimeZone(String)
    case invalidWindowConfig([String])
    case emptyActivityId
    case emptyAppToken
    case invalidUsageConfig
}

public enum PolicySyncDecoder {
    /// Decodes and validates raw bytes into a `DecodedSchedulePolicy`.
    /// NEVER guesses/invents a substitute value for a missing or
    /// malformed field -- every failure mode throws a specific,
    /// enumerated error rather than falling back to a default policy
    /// (PCA-15 correction F1: "never invent policy").
    public static func decode(_ data: Data) -> Result<DecodedSchedulePolicy, PolicySyncDecodeError> {
        guard data.count <= 1_048_576 else { return .failure(.malformedData) }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        guard let stored = try? decoder.decode(StoredDeviceActivityPolicy.self, from: data) else {
            return .failure(.malformedData)
        }
        return validate(stored)
    }

    static func validate(_ stored: StoredDeviceActivityPolicy) -> Result<DecodedSchedulePolicy, PolicySyncDecodeError> {
        guard stored.schemaVersion == policySyncSchemaVersion else {
            return .failure(.unsupportedSchemaVersion(found: stored.schemaVersion, expected: policySyncSchemaVersion))
        }
        guard !stored.activityId.isEmpty else { return .failure(.emptyActivityId) }
        guard !stored.appToken.isEmpty else { return .failure(.emptyAppToken) }
        guard stored.appToken.utf8.count <= 256, stored.activityId.utf8.count <= 256,
              stored.bonusGrants.count <= 64,
              stored.bonusGrants.allSatisfy({ (0...DeviceActivityUsagePlanner.maximumMinutes).contains($0.extraMinutes) && $0.expiresAtUtc > $0.grantedAtUtc }),
              stored.dailyLimit.map({ (0...DeviceActivityUsagePlanner.maximumMinutes).contains($0.limitMinutes) &&
                  (0...DeviceActivityUsagePlanner.maximumMinutes).contains($0.usedMinutesToday) &&
                  isCanonicalGregorianLocalDate($0.anchorLocalDate) }) ?? true else {
            return .failure(.invalidUsageConfig)
        }
        guard let timeZone = TimeZone(identifier: stored.timeZoneIdentifier) else {
            return .failure(.unrecognizedTimeZone(stored.timeZoneIdentifier))
        }

        var windows: [ScheduleWindow] = []
        for window in stored.windows {
            let windowZone: TimeZone
            if let identifier = window.timezone {
                guard let explicitZone = TimeZone(identifier: identifier) else { return .failure(.unrecognizedTimeZone(identifier)) }
                windowZone = explicitZone
            } else { windowZone = timeZone } // Deliberate legacy snapshot compatibility.
            windows.append(toDomainWindow(window, timeZone: windowZone))
        }
        let configErrors = windows.flatMap(ScheduleEngine.validate)
        guard configErrors.isEmpty else {
            return .failure(.invalidWindowConfig(configErrors))
        }

        let bonusGrants = stored.bonusGrants.map {
            BonusGrant(id: $0.id, appScope: toDomainScope($0.appScope), extraMinutes: $0.extraMinutes, grantedAt: $0.grantedAtUtc, expiresAt: $0.expiresAtUtc)
        }
        let exceptions = stored.exceptions.map {
            ParentException(id: $0.id, appScope: toDomainScope($0.appScope), startAt: $0.startAtUtc, endAt: $0.endAtUtc)
        }
        let dailyLimit = stored.dailyLimit.map {
            DailyAppLimit(appScope: toDomainScope($0.appScope), limitMinutes: $0.limitMinutes, usedMinutesToday: $0.usedMinutesToday, anchorLocalDate: $0.anchorLocalDate)
        }
        let enforcement: EnforcementCapabilityState
        switch stored.enforcementCapability {
        case .enforced: enforcement = .enforced
        case .degraded: enforcement = .degraded
        case .unavailable: enforcement = .unavailable
        }

        return .success(DecodedSchedulePolicy(
            activityId: stored.activityId, appToken: stored.appToken, timeZone: timeZone,
            windows: windows, bonusGrants: bonusGrants, exceptions: exceptions,
            dailyLimit: dailyLimit, enforcementCapability: enforcement
        ))
    }

    private static func toDomainScope(_ stored: StoredAppScope) -> AppScope {
        switch stored {
        case .all: return .all
        case .apps(let set): return .apps(set)
        }
    }

    /// The schedule contract's local-date anchor is exactly `YYYY-MM-DD`.
    /// Validate by constructing a UTC Gregorian date and round-tripping its
    /// components; never allow Calendar normalization (for example February
    /// 30) to turn malformed usage state into an implicit daily reset.
    private static func isCanonicalGregorianLocalDate(_ value: String) -> Bool {
        let bytes = Array(value.utf8)
        guard bytes.count == 10, bytes[4] == 45, bytes[7] == 45 else { return false }

        func number(_ range: Range<Int>) -> Int? {
            let digits = bytes[range]
            guard digits.allSatisfy({ (48...57).contains($0) }) else { return nil }
            return digits.reduce(0) { $0 * 10 + Int($1 - 48) }
        }

        guard let year = number(0..<4), year > 0,
              let month = number(5..<7), let day = number(8..<10) else { return false }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        var components = DateComponents()
        components.year = year
        components.month = month
        components.day = day
        components.hour = 12
        guard let date = calendar.date(from: components) else { return false }
        let roundTrip = calendar.dateComponents([.year, .month, .day], from: date)
        return roundTrip.year == year && roundTrip.month == month && roundTrip.day == day
    }

    private static func toDomainWindow(_ stored: StoredScheduleWindow, timeZone: TimeZone) -> ScheduleWindow {
        ScheduleWindow(
            id: stored.id, kind: stored.kind, daysOfWeek: stored.daysOfWeek,
            start: TimeOfDay(hour: stored.start.hour, minute: stored.start.minute),
            end: TimeOfDay(hour: stored.end.hour, minute: stored.end.minute),
            appScope: toDomainScope(stored.appScope), timeZone: timeZone
        )
    }
}
