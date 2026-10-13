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
    /// Stored FamilyControls token payloads use the same 1 MiB bound as the
    /// decoded policy document. Check bytes before invoking PropertyListDecoder
    /// so corrupted App Group state cannot trigger an unbounded decode.
    private static var maximumTokenPayloadBytes: Int { 1_048_576 }
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
              tokenData.count <= Self.maximumTokenPayloadBytes,
              let tokens = try? PropertyListDecoder().decode(Set<Token>.self, from: tokenData) else { return nil }
        let protectedTokens: Set<Token>
        if let data = tokenStore.read(forKey: "protectedApplicationTokens\(suffix)") {
            guard data.count <= Self.maximumTokenPayloadBytes,
                  let decoded = try? PropertyListDecoder().decode(Set<Token>.self, from: data) else { return nil }
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
        let expectedActivity = Data(monitorActivityId.utf8)
        guard scheduleStore.read(forKey: "activeActivityId") == expectedActivity,
              let snapshot = loader.load(activityId: monitorActivityId),
              scheduleStore.read(forKey: "activeActivityId") == expectedActivity else { return nil }
        return snapshot
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
    /// Shared schedule-contract numbering: 0 = Sunday through 6 = Saturday.
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
    case invalidExceptionConfig([String])
    case emptyActivityId
    case emptyAppToken
    case invalidAppScope([String])
    case invalidUsageConfig
}

/// `Codable` intentionally ignores unknown object members. That is convenient
/// for many APIs, but a persisted schema-versioned policy must be a closed
/// document: otherwise a newer or corrupt writer could add policy semantics
/// that this extension silently ignores. StrictJSONDocument has already
/// rejected malformed grammar and duplicate decoded member names before this
/// shape check runs.
private enum StoredPolicyJSONShapeValidator {
    static func accepts(_ data: Data) -> Bool {
        guard let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let policy = object(root, required: [
                "schemaVersion", "activityId", "appToken", "timeZoneIdentifier",
                "windows", "bonusGrants", "exceptions", "enforcementCapability",
              ], optional: ["dailyLimit"]),
              let windows = policy["windows"] as? [Any], windows.allSatisfy(window),
              let bonusGrants = policy["bonusGrants"] as? [Any], bonusGrants.allSatisfy(bonusGrant),
              let exceptions = policy["exceptions"] as? [Any], exceptions.allSatisfy(parentException) else {
            return false
        }
        if let dailyLimit = policy["dailyLimit"], !(dailyLimit is NSNull), !dailyAppLimit(dailyLimit) {
            return false
        }
        return true
    }

    private static func window(_ value: Any) -> Bool {
        guard let fields = object(value, required: ["id", "kind", "daysOfWeek", "start", "end", "appScope"],
                                  optional: ["timezone"]),
              let scope = fields["appScope"], appScope(scope),
              let start = fields["start"], object(start, required: ["hour", "minute"]) != nil,
              let end = fields["end"], object(end, required: ["hour", "minute"]) != nil else {
            return false
        }
        return true
    }

    private static func bonusGrant(_ value: Any) -> Bool {
        guard let fields = object(value, required: ["id", "appScope", "extraMinutes", "grantedAtUtc", "expiresAtUtc"]),
              let scope = fields["appScope"] else {
            return false
        }
        return appScope(scope)
    }

    private static func parentException(_ value: Any) -> Bool {
        guard let fields = object(value, required: ["id", "appScope", "startAtUtc", "endAtUtc"]),
              let scope = fields["appScope"] else {
            return false
        }
        return appScope(scope)
    }

    private static func dailyAppLimit(_ value: Any) -> Bool {
        guard let fields = object(value, required: ["appScope", "limitMinutes", "usedMinutesToday", "anchorLocalDate"]),
              let scope = fields["appScope"] else {
            return false
        }
        return appScope(scope)
    }

    /// Synthesized Codable enum form: `{ "all": {} }` or
    /// `{ "apps": { "_0": ["..."] } }`.
    private static func appScope(_ value: Any) -> Bool {
        guard let cases = value as? [String: Any], cases.count == 1 else { return false }
        if let allPayload = cases["all"] {
            guard let fields = allPayload as? [String: Any] else { return false }
            return fields.isEmpty
        }
        guard let appsPayload = cases["apps"],
              let fields = object(appsPayload, required: ["_0"]),
              let appIds = fields["_0"] as? [Any] else { return false }
        return appIds.allSatisfy { $0 is String }
    }

    private static func object(_ value: Any, required: Set<String>, optional: Set<String> = []) -> [String: Any]? {
        guard let fields = value as? [String: Any] else { return nil }
        let keys = Set(fields.keys)
        guard required.isSubset(of: keys), keys.isSubset(of: required.union(optional)) else { return nil }
        return fields
    }
}

public enum PolicySyncDecoder {
    /// Match ScheduleEngine's JavaScript Date range before decoded exceptions
    /// can reach persistence or enforcement.
    private static let maximumPolicyDateSeconds = 8_640_000_000_000.0

    /// Decodes and validates raw bytes into a `DecodedSchedulePolicy`.
    /// NEVER guesses/invents a substitute value for a missing or
    /// malformed field -- every failure mode throws a specific,
    /// enumerated error rather than falling back to a default policy
    /// (PCA-15 correction F1: "never invent policy").
    public static func decode(_ data: Data) -> Result<DecodedSchedulePolicy, PolicySyncDecodeError> {
        guard data.count <= 1_048_576 else { return .failure(.malformedData) }
        do { try StrictJSONDocument.validateNoDuplicateMembers(data) }
        catch { return .failure(.malformedData) }
        guard StoredPolicyJSONShapeValidator.accepts(data) else { return .failure(.malformedData) }
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
        guard hasValidUsageConfiguration(stored) else {
            return .failure(.invalidUsageConfig)
        }
        let scopeErrors = stored.windows.compactMap { validateAppScope($0.appScope, description: "window \($0.id)") }
            + stored.bonusGrants.compactMap { validateAppScope($0.appScope, description: "bonus grant \($0.id)") }
            + stored.exceptions.compactMap { validateAppScope($0.appScope, description: "parent exception \($0.id)") }
            + (stored.dailyLimit.map { validateAppScope($0.appScope, description: "daily limit") } ?? [])
        guard scopeErrors.isEmpty else { return .failure(.invalidAppScope(scopeErrors)) }
        let exceptionErrors = stored.exceptions.compactMap { exception -> String? in
            let start = exception.startAtUtc.timeIntervalSince1970
            let end = exception.endAtUtc.timeIntervalSince1970
            guard start.isFinite, end.isFinite,
                  abs(start) <= maximumPolicyDateSeconds, abs(end) <= maximumPolicyDateSeconds,
                  start < end else {
                return "parent exception \(exception.id): startAt and endAt must be finite in-range instants with startAt before endAt"
            }
            return nil
        }
        guard exceptionErrors.isEmpty else { return .failure(.invalidExceptionConfig(exceptionErrors)) }
        guard let timeZone = TimeZone(identifier: stored.timeZoneIdentifier) else {
            return .failure(.unrecognizedTimeZone(stored.timeZoneIdentifier))
        }

        var windows: [ScheduleWindow] = []
        for window in stored.windows {
            guard window.daysOfWeek.allSatisfy({ (0...6).contains($0) }) else {
                return .failure(.invalidWindowConfig(["window \(window.id): daysOfWeek must use contract indices 0...6"]))
            }
            let windowZone: TimeZone
            if let identifier = window.timezone {
                guard let explicitZone = TimeZone(identifier: identifier) else { return .failure(.unrecognizedTimeZone(identifier)) }
                windowZone = explicitZone
            } else { windowZone = timeZone } // Deliberate legacy snapshot compatibility.
            // Foundation Calendar numbers weekdays 1...7 (Sunday...Saturday),
            // while the shared/backend and Android schedule contract is 0...6.
            windows.append(toDomainWindow(window, timeZone: windowZone,
                calendarWeekdays: Set(window.daysOfWeek.map { $0 + 1 })))
        }
        // Validate the complete set before publishing it to the runtime. In
        // addition to each window's shape, evaluation requires unique opaque
        // window IDs so matched-window provenance cannot be ambiguous.
        let configErrors = ScheduleEngine.validateWindows(windows)
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

    private static func hasValidUsageConfiguration(_ stored: StoredDeviceActivityPolicy) -> Bool {
        guard stored.appToken.utf8.count <= 256,
              stored.activityId.utf8.count <= 256,
              stored.bonusGrants.count <= 64 else { return false }

        for grant in stored.bonusGrants {
            let start = grant.grantedAtUtc.timeIntervalSince1970
            let end = grant.expiresAtUtc.timeIntervalSince1970
            guard (0...DeviceActivityUsagePlanner.maximumMinutes).contains(grant.extraMinutes),
                  start.isFinite,
                  end.isFinite,
                  abs(start) <= maximumPolicyDateSeconds,
                  abs(end) <= maximumPolicyDateSeconds,
                  start < end else { return false }
        }

        if let dailyLimit = stored.dailyLimit {
            guard (0...DeviceActivityUsagePlanner.maximumMinutes).contains(dailyLimit.limitMinutes),
                  (0...DeviceActivityUsagePlanner.maximumMinutes).contains(dailyLimit.usedMinutesToday),
                  isCanonicalGregorianLocalDate(dailyLimit.anchorLocalDate) else { return false }
        }
        return true
    }

    /// Match the backend schedule validator: an app-list scope may not carry
    /// an empty opaque token. A blank member silently matches no application
    /// and can turn an intended exception/window/limit into a no-op.
    private static func validateAppScope(_ scope: StoredAppScope, description: String) -> String? {
        guard case .apps(let tokens) = scope,
              tokens.contains(where: { $0.isEmpty }) else { return nil }
        return "\(description) appScope must contain non-empty app tokens"
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

    private static func toDomainWindow(
        _ stored: StoredScheduleWindow,
        timeZone: TimeZone,
        calendarWeekdays: Set<Int>
    ) -> ScheduleWindow {
        ScheduleWindow(
            id: stored.id, kind: stored.kind, daysOfWeek: calendarWeekdays,
            start: TimeOfDay(hour: stored.start.hour, minute: stored.start.minute),
            end: TimeOfDay(hour: stored.end.hour, minute: stored.end.minute),
            appScope: toDomainScope(stored.appScope), timeZone: timeZone
        )
    }
}
