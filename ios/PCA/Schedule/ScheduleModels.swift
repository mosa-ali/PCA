import Foundation

/// Swift-side mirror of backend/src/schedule/types.ts's policy shape
/// (PCA-4). This is the SAME policy the backend/Android adapters consume
/// -- doc 07 Section 6/12's "consume existing PCA policies, do not create
/// a separate policy authority" -- decoded from the signed policy
/// envelope's (already-decrypted, already-authorized) payload. This file
/// only defines the shape and the deterministic decision function;
/// envelope verification, decryption, and payload authorization are doc
/// 22's job, owned elsewhere.
public struct TimeOfDay: Equatable, Codable {
    public let hour: Int
    public let minute: Int
    public init(hour: Int, minute: Int) {
        self.hour = hour
        self.minute = minute
    }
}

public enum ScheduleWindowKind: String, Equatable, Codable {
    case bedtime = "BEDTIME"
    case schoolMode = "SCHOOL_MODE"
    case allowPeriod = "ALLOW_PERIOD"
    case blockPeriod = "BLOCK_PERIOD"
}

public enum AppScope: Equatable, Codable {
    case all
    case apps(Set<String>)

    public func includes(_ appToken: String) -> Bool {
        switch self {
        case .all: return true
        case .apps(let set): return set.contains(appToken)
        }
    }
}

/// `daysOfWeek` uses `Calendar`'s own weekday numbering (1 = Sunday ... 7
/// = Saturday) to avoid a second, ad hoc convention on this platform.
public struct ScheduleWindow: Equatable {
    public let id: String
    public let kind: ScheduleWindowKind
    public let daysOfWeek: Set<Int>
    public let start: TimeOfDay
    public let end: TimeOfDay
    public let appScope: AppScope
    public let timeZone: TimeZone

    public init(id: String, kind: ScheduleWindowKind, daysOfWeek: Set<Int>, start: TimeOfDay, end: TimeOfDay, appScope: AppScope, timeZone: TimeZone) {
        self.id = id
        self.kind = kind
        self.daysOfWeek = daysOfWeek
        self.start = start
        self.end = end
        self.appScope = appScope
        self.timeZone = timeZone
    }
}

public struct BonusGrant: Equatable {
    public let id: String
    public let appScope: AppScope
    public let extraMinutes: Int
    public let grantedAt: Date
    public let expiresAt: Date
    public init(id: String, appScope: AppScope, extraMinutes: Int, grantedAt: Date, expiresAt: Date) {
        self.id = id; self.appScope = appScope; self.extraMinutes = extraMinutes
        self.grantedAt = grantedAt; self.expiresAt = expiresAt
    }
}

public struct ParentException: Equatable {
    public let id: String
    public let appScope: AppScope
    public let startAt: Date
    public let endAt: Date
    public init(id: String, appScope: AppScope, startAt: Date, endAt: Date) {
        self.id = id; self.appScope = appScope; self.startAt = startAt; self.endAt = endAt
    }
}

public struct DailyAppLimit: Equatable {
    public let appScope: AppScope
    public let limitMinutes: Int
    public let usedMinutesToday: Int
    /// `YYYY-MM-DD` in the policy's own time zone -- see engine.ts's identical convention.
    public let anchorLocalDate: String
    public init(appScope: AppScope, limitMinutes: Int, usedMinutesToday: Int, anchorLocalDate: String) {
        self.appScope = appScope; self.limitMinutes = limitMinutes
        self.usedMinutesToday = usedMinutesToday; self.anchorLocalDate = anchorLocalDate
    }
}

public enum EnforcementCapabilityState: Equatable {
    case enforced
    case degraded
    case unavailable
}

public enum ScheduleDecisionKind: Equatable {
    case allowed
    case allowedBonus
    case allowedException
    case blockedBedtime
    case blockedSchoolMode
    case blockedPeriod
    case blockedOutsideAllowPeriod
    case blockedLimitReached
    case enforcementUnavailable
    case invalidConfig
}

public struct ScheduleDecision: Equatable {
    public let kind: ScheduleDecisionKind
    public let reason: String
    public let matchedWindowIds: [String]
    public let intendedKind: ScheduleDecisionKind?
    public let remainingMinutesToday: Int?
    public let configErrors: [String]

    public init(
        kind: ScheduleDecisionKind,
        reason: String,
        matchedWindowIds: [String] = [],
        intendedKind: ScheduleDecisionKind? = nil,
        remainingMinutesToday: Int? = nil,
        configErrors: [String] = []
    ) {
        self.kind = kind
        self.reason = reason
        self.matchedWindowIds = matchedWindowIds
        self.intendedKind = intendedKind
        self.remainingMinutesToday = remainingMinutesToday
        self.configErrors = configErrors
    }

    /// Whether this decision, if it could be enforced, restricts the app --
    /// mirrors backend/src/schedule/engine.ts's `isRestrictive`.
    public var isRestrictive: Bool {
        switch kind {
        case .blockedBedtime, .blockedSchoolMode, .blockedPeriod, .blockedOutsideAllowPeriod, .blockedLimitReached:
            return true
        default:
            return false
        }
    }
}

public struct ScheduleEvaluationInput {
    public let nowUtc: Date
    public let timeZone: TimeZone
    public let appToken: String
    public let windows: [ScheduleWindow]
    public let bonusGrants: [BonusGrant]
    public let exceptions: [ParentException]
    public let dailyLimit: DailyAppLimit?
    public let enforcementCapability: EnforcementCapabilityState

    public init(
        nowUtc: Date, timeZone: TimeZone, appToken: String, windows: [ScheduleWindow],
        bonusGrants: [BonusGrant], exceptions: [ParentException], dailyLimit: DailyAppLimit?,
        enforcementCapability: EnforcementCapabilityState
    ) {
        self.nowUtc = nowUtc; self.timeZone = timeZone; self.appToken = appToken
        self.windows = windows; self.bonusGrants = bonusGrants; self.exceptions = exceptions
        self.dailyLimit = dailyLimit; self.enforcementCapability = enforcementCapability
    }
}
