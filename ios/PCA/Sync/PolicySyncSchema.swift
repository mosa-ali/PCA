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

public struct StoredTimeOfDay: Codable, Equatable {
    public let hour: Int
    public let minute: Int
    public init(hour: Int, minute: Int) { self.hour = hour; self.minute = minute }
}

public enum StoredAppScope: Codable, Equatable {
    case all
    case apps(Set<String>)
}

public struct StoredScheduleWindow: Codable, Equatable {
    public let id: String
    public let kind: ScheduleWindowKind
    public let daysOfWeek: Set<Int>
    public let start: StoredTimeOfDay
    public let end: StoredTimeOfDay
    public let appScope: StoredAppScope

    public init(id: String, kind: ScheduleWindowKind, daysOfWeek: Set<Int>, start: StoredTimeOfDay, end: StoredTimeOfDay, appScope: StoredAppScope) {
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
}

public enum PolicySyncDecoder {
    /// Decodes and validates raw bytes into a `DecodedSchedulePolicy`.
    /// NEVER guesses/invents a substitute value for a missing or
    /// malformed field -- every failure mode throws a specific,
    /// enumerated error rather than falling back to a default policy
    /// (PCA-15 correction F1: "never invent policy").
    public static func decode(_ data: Data) -> Result<DecodedSchedulePolicy, PolicySyncDecodeError> {
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
        guard let timeZone = TimeZone(identifier: stored.timeZoneIdentifier) else {
            return .failure(.unrecognizedTimeZone(stored.timeZoneIdentifier))
        }

        let windows = stored.windows.map { toDomainWindow($0, timeZone: timeZone) }
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

    private static func toDomainWindow(_ stored: StoredScheduleWindow, timeZone: TimeZone) -> ScheduleWindow {
        ScheduleWindow(
            id: stored.id, kind: stored.kind, daysOfWeek: stored.daysOfWeek,
            start: TimeOfDay(hour: stored.start.hour, minute: stored.start.minute),
            end: TimeOfDay(hour: stored.end.hour, minute: stored.end.minute),
            appScope: toDomainScope(stored.appScope), timeZone: timeZone
        )
    }
}
