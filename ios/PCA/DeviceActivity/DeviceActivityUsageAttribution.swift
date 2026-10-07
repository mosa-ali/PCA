import Foundation

/// Supplied explicitly by a caller that already verified the policy/selection association.
/// A singleton picker selection alone does not establish a logical application identity.
public struct DeviceActivityUsageSelectionBinding: Codable, Equatable {
    public let logicalAppToken: String
    public let applicationTokenData: Data
    public init(logicalAppToken: String, applicationTokenData: Data) {
        self.logicalAppToken = logicalAppToken; self.applicationTokenData = applicationTokenData
    }
    public static func == (lhs: Self, rhs: Self) -> Bool {
        lhs.logicalAppToken.utf8.elementsEqual(rhs.logicalAppToken.utf8) && lhs.applicationTokenData == rhs.applicationTokenData
    }
    public var isValid: Bool {
        !logicalAppToken.isEmpty && logicalAppToken.utf8.count <= 256 &&
            !applicationTokenData.isEmpty && applicationTokenData.count <= 8_192
    }
    public func matches<Token: Hashable & Codable>(_ tokens: Set<Token>, logicalAppToken: String) -> Bool {
        guard isValid, self.logicalAppToken.utf8.elementsEqual(logicalAppToken.utf8), tokens.count == 1,
              let token = try? PropertyListDecoder().decode(Token.self, from: applicationTokenData) else { return false }
        return tokens.contains(token)
    }
}

public enum DeviceActivityUsageCoverage: String, Codable {
    /// Planned accounting interval; neither case proves callback delivery or gapless history.
    case wholePolicyDayPlanned, partialPolicyDayPlanned
}
public enum DeviceActivityUsageMonitorStatus: Equatable {
    case unavailable, expired, deviceTimeZoneChanged
    case planned(DeviceActivityUsageCoverage)
}
public struct DeviceActivityUsageThreshold: Codable, Equatable {
    public let eventId: String
    public let minutes: Int
    public init(eventId: String, minutes: Int) { self.eventId = eventId; self.minutes = minutes }
}
public enum DeviceActivityUsageError: Error, Equatable {
    case unsupportedBinding, unsupportedHistoricalActivity, malformedPlan, excessiveMonitors
    case excessiveThresholds, invalidNumericPolicy, unavailableState, persistenceFailed, staleCallback
}

public struct DeviceActivityUsageDayPlan: Codable, Equatable {
    public let binding: DeviceActivityUsageSelectionBinding
    public let policyActivityId: String
    public let generation: String
    public let monitorActivityId: String
    public let localDate: String
    public let policyTimeZoneIdentifier: String
    public let deviceTimeZoneIdentifier: String
    public let dayStartUtc: Date
    public let dayEndUtc: Date
    public let accountingStartUtc: Date
    public let coverage: DeviceActivityUsageCoverage
    public let thresholds: [DeviceActivityUsageThreshold]

    public var isValid: Bool {
        guard binding.isValid, !policyActivityId.isEmpty, policyActivityId.utf8.count <= 256,
              UUID(uuidString: generation) != nil, monitorActivityId.hasPrefix("pca-monitor-"),
              UUID(uuidString: String(monitorActivityId.dropFirst("pca-monitor-".count))) != nil,
              let zone = TimeZone(identifier: policyTimeZoneIdentifier),
              let deviceZone = TimeZone(identifier: deviceTimeZoneIdentifier),
              dayStartUtc.timeIntervalSince1970.isFinite, dayEndUtc.timeIntervalSince1970.isFinite,
              accountingStartUtc.timeIntervalSince1970.isFinite,
              accountingStartUtc >= dayStartUtc, accountingStartUtc < dayEndUtc,
              dayEndUtc.timeIntervalSince(accountingStartUtc) >= 900,
              thresholds.count <= 64 else { return false }
        var calendar = Calendar(identifier: .gregorian); calendar.timeZone = zone
        guard let interval = calendar.dateInterval(of: .day, for: dayStartUtc),
              interval.start == dayStartUtc, interval.end == dayEndUtc,
              ScheduleEngine.localDateString(dayStartUtc, timeZone: zone).utf8.elementsEqual(localDate.utf8) else { return false }
        var deviceCalendar = Calendar(identifier: .gregorian); deviceCalendar.timeZone = deviceZone
        guard deviceCalendar.dateInterval(of: .hour, for: accountingStartUtc)?.start == accountingStartUtc else { return false }
        if coverage == .wholePolicyDayPlanned {
            guard policyTimeZoneIdentifier.utf8.elementsEqual(deviceTimeZoneIdentifier.utf8), accountingStartUtc == dayStartUtc else { return false }
        }
        return Set(thresholds.map(\.eventId)).count == thresholds.count &&
            Set(thresholds.map(\.minutes)).count == thresholds.count && thresholds.allSatisfy {
                $0.minutes > 0 && $0.minutes <= DeviceActivityUsagePlanner.maximumMinutes &&
                    $0.eventId.hasPrefix("pca-usage-event-") &&
                    UUID(uuidString: String($0.eventId.dropFirst("pca-usage-event-".count))) != nil
            }
    }

    public func contains(_ date: Date, deviceTimeZone: TimeZone) -> Bool {
        isValid && date.timeIntervalSince1970.isFinite && date >= accountingStartUtc && date < dayEndUtc &&
            deviceTimeZoneIdentifier.utf8.elementsEqual(deviceTimeZone.identifier.utf8)
    }
    public func status(at date: Date, deviceTimeZone: TimeZone) -> DeviceActivityUsageMonitorStatus {
        guard isValid, date.timeIntervalSince1970.isFinite else { return .unavailable }
        guard date < dayEndUtc else { return .expired }
        guard date >= accountingStartUtc else { return .unavailable }
        guard deviceTimeZoneIdentifier.utf8.elementsEqual(deviceTimeZone.identifier.utf8) else {
            return .deviceTimeZoneChanged
        }
        return .planned(coverage)
    }
    /// Re-derive accounting bounds and threshold values from the stored policy.
    /// Random monitor/event identifiers are registration metadata, not policy authority.
    public func matches(policy: DecodedSchedulePolicy) -> Bool {
        guard isValid, policyActivityId.utf8.elementsEqual(policy.activityId.utf8),
              policyTimeZoneIdentifier.utf8.elementsEqual(policy.timeZone.identifier.utf8),
              let deviceZone = TimeZone(identifier: deviceTimeZoneIdentifier),
              let expected = try? DeviceActivityUsagePlanner.plan(policy: policy, binding: binding,
                generation: generation, now: dayStartUtc, deviceTimeZone: deviceZone,
                historicalActivitySupported: true, otherMonitorCount: 0) else { return false }
        return dayStartUtc == expected.dayStartUtc && dayEndUtc == expected.dayEndUtc &&
            accountingStartUtc == expected.accountingStartUtc && localDate == expected.localDate &&
            coverage == expected.coverage && Set(thresholds.map(\.minutes)) == Set(expected.thresholds.map(\.minutes))
    }
    public static func == (lhs: Self, rhs: Self) -> Bool {
        lhs.binding == rhs.binding && lhs.policyActivityId.utf8.elementsEqual(rhs.policyActivityId.utf8) &&
            lhs.generation == rhs.generation && lhs.monitorActivityId == rhs.monitorActivityId &&
            lhs.localDate == rhs.localDate && lhs.policyTimeZoneIdentifier == rhs.policyTimeZoneIdentifier &&
            lhs.deviceTimeZoneIdentifier == rhs.deviceTimeZoneIdentifier && lhs.dayStartUtc == rhs.dayStartUtc &&
            lhs.dayEndUtc == rhs.dayEndUtc && lhs.accountingStartUtc == rhs.accountingStartUtc &&
            lhs.coverage == rhs.coverage && lhs.thresholds == rhs.thresholds
    }
}

public enum DeviceActivityUsagePlanner {
    public static let maximumMinutes = 1_000_000
    public static func plan(policy: DecodedSchedulePolicy, binding: DeviceActivityUsageSelectionBinding,
                            generation: String, now: Date, deviceTimeZone: TimeZone,
                            historicalActivitySupported: Bool, otherMonitorCount: Int) throws -> DeviceActivityUsageDayPlan {
        guard historicalActivitySupported else { throw DeviceActivityUsageError.unsupportedHistoricalActivity }
        guard binding.isValid, binding.logicalAppToken.utf8.elementsEqual(policy.appToken.utf8),
              let limit = policy.dailyLimit else { throw DeviceActivityUsageError.unsupportedBinding }
        switch limit.appScope {
        case .all: break
        case .apps(let apps):
            guard apps.count == 1, apps.contains(where: { $0.utf8.elementsEqual(policy.appToken.utf8) }) else {
                throw DeviceActivityUsageError.unsupportedBinding
            }
        }
        guard now.timeIntervalSince1970.isFinite, UUID(uuidString: generation) != nil,
              otherMonitorCount >= 0, otherMonitorCount < 20 else { throw DeviceActivityUsageError.excessiveMonitors }
        guard (0...maximumMinutes).contains(limit.limitMinutes), (0...maximumMinutes).contains(limit.usedMinutesToday),
              policy.bonusGrants.count <= 64, policy.bonusGrants.allSatisfy({
                  (0...maximumMinutes).contains($0.extraMinutes) && $0.grantedAt.timeIntervalSince1970.isFinite &&
                      $0.expiresAt.timeIntervalSince1970.isFinite && $0.expiresAt > $0.grantedAt
              }) else { throw DeviceActivityUsageError.invalidNumericPolicy }
        var calendar = Calendar(identifier: .gregorian); calendar.timeZone = policy.timeZone
        guard let day = calendar.dateInterval(of: .day, for: now) else { throw DeviceActivityUsageError.malformedPlan }
        var deviceCalendar = Calendar(identifier: .gregorian); deviceCalendar.timeZone = deviceTimeZone
        guard let hour = deviceCalendar.dateInterval(of: .hour, for: day.start) else { throw DeviceActivityUsageError.malformedPlan }
        // includesPastActivity rounds an unaligned start down to the device's hour.
        // Move forward instead, so any included history stays inside the policy day.
        let accountingStart = day.start == hour.start ? day.start : hour.end
        guard accountingStart < day.end, day.end.timeIntervalSince(accountingStart) >= 900 else {
            throw DeviceActivityUsageError.malformedPlan
        }
        let bonuses = policy.bonusGrants.filter { $0.appScope.includes(policy.appToken) }
        var edges = [day.start]
        edges += bonuses.flatMap { [$0.grantedAt, $0.expiresAt] }.filter { $0 >= day.start && $0 < day.end }
        var values = Set<Int>()
        for edge in edges {
            var total = limit.limitMinutes
            for bonus in bonuses where edge >= bonus.grantedAt && edge < bonus.expiresAt {
                let sum = total.addingReportingOverflow(bonus.extraMinutes)
                guard !sum.overflow, sum.partialValue <= maximumMinutes else { throw DeviceActivityUsageError.invalidNumericPolicy }
                total = sum.partialValue
            }
            if total > 0 { values.insert(total) }
        }
        guard values.count <= 64 else { throw DeviceActivityUsageError.excessiveThresholds }
        let result = DeviceActivityUsageDayPlan(binding: binding, policyActivityId: policy.activityId,
            generation: generation, monitorActivityId: "pca-monitor-" + UUID().uuidString.lowercased(),
            localDate: ScheduleEngine.localDateString(day.start, timeZone: policy.timeZone),
            policyTimeZoneIdentifier: policy.timeZone.identifier, deviceTimeZoneIdentifier: deviceTimeZone.identifier,
            dayStartUtc: day.start, dayEndUtc: day.end, accountingStartUtc: accountingStart,
            coverage: policy.timeZone.identifier.utf8.elementsEqual(deviceTimeZone.identifier.utf8) && accountingStart == day.start
                ? .wholePolicyDayPlanned : .partialPolicyDayPlanned,
            thresholds: values.sorted().map { DeviceActivityUsageThreshold(eventId: "pca-usage-event-" + UUID().uuidString.lowercased(), minutes: $0) })
        guard result.isValid else { throw DeviceActivityUsageError.malformedPlan }
        return result
    }
}

/// The association snapshot adapter must replace one key atomically. The
/// AppGroupDeviceActivityFileStore adapter below satisfies this contract.
public protocol DeviceActivityUsageAssociationSnapshotPersistence {
    func writeAtomically(_ data: Data, forKey key: String) throws
    func read(forKey key: String) -> Data?
    func remove(forKey key: String)
}

#if canImport(Darwin)
extension AppGroupDeviceActivityFileStore: DeviceActivityUsageAssociationSnapshotPersistence {
    public func writeAtomically(_ data: Data, forKey key: String) throws {
        try write(data, forKey: key)
    }
}
#endif

/// Caller supplied family/device identity. This value scopes a stored picker-token
/// association; it is never derived from the policy payload or token serialization.
public struct DeviceActivityUsageAssociationScope: Codable, Equatable {
    public let familyId: String
    public let deviceId: String

    public init(familyId: String, deviceId: String) {
        self.familyId = familyId
        self.deviceId = deviceId
    }

    public static func == (lhs: Self, rhs: Self) -> Bool {
        lhs.familyId.utf8.elementsEqual(rhs.familyId.utf8) &&
            lhs.deviceId.utf8.elementsEqual(rhs.deviceId.utf8)
    }

    fileprivate var isValid: Bool {
        !familyId.isEmpty && familyId.utf8.count <= 256 &&
            !deviceId.isEmpty && deviceId.utf8.count <= 256
    }
}

public enum DeviceActivityUsageAssociationError: Error, Equatable {
    case invalidAssociation, staleRevision, conflictingReplay, unavailableState
    case persistenceFailed, authorityRejected, invalidLockAccess
}

/// Exact context a trusted caller must compare with its current authority
/// source. A recreated store may retain an old snapshot after total persistence
/// failure, so a successful revalidation must independently establish that this
/// scope/app/binding/revision is still accepted.
public struct DeviceActivityUsageAssociationAuthorityContext {
    public let scope: DeviceActivityUsageAssociationScope
    public let logicalAppToken: String
    public let binding: DeviceActivityUsageSelectionBinding?
    public let authorityBinding: Data
    public let revision: UInt64?

    fileprivate init(scope: DeviceActivityUsageAssociationScope, logicalAppToken: String,
                     binding: DeviceActivityUsageSelectionBinding?, authorityBinding: Data,
                     revision: UInt64?) {
        self.scope = scope
        self.logicalAppToken = logicalAppToken
        self.binding = binding
        self.authorityBinding = authorityBinding
        self.revision = revision
    }
}

public typealias DeviceActivityUsageAssociationAuthorityRevalidator =
    (DeviceActivityUsageAssociationAuthorityContext) throws -> Void

/// Durable custody for an already-authorized logical-app to Family Controls
/// token mapping. The producer must verify the association before calling this
/// API. Production resolution stays unavailable unless a caller supplies the
/// current family/device scope, accepted authority binding, and revalidator.
/// The App Group adapter stores token bytes and authority bytes as opaque local
/// data without encryption at this layer. Authority bindings must be non-secret
/// revisions or fingerprints; never pass credentials or bearer tokens.
///
/// Every operation uses the caller's shared DeviceActivity policy lock. Any
/// authority mutation that changes the accepted mapping must serialize against
/// this same lock. Revalidation receives the exact scope, opaque accepted
/// authority binding, and (when known) record revision. A separate ownership
/// marker distinguishes a never-created store from a lost,
/// partially written, or corrupt snapshot; established state is never silently
/// reconstructed as empty.
public final class DeviceActivityUsageAssociationStore<Token: Hashable & Codable> {
    private struct Record: Codable {
        let scope: DeviceActivityUsageAssociationScope
        let logicalAppToken: String
        let binding: DeviceActivityUsageSelectionBinding?
        let authorityBinding: Data
        let revision: UInt64
        let revoked: Bool
    }
    private struct State: Codable {
        let schemaVersion: Int
        var records: [Record]
    }

    private static var stateKey: String { "com.pca.app.deviceactivity.usage-associations.v1" }
    private static var ownershipKey: String { "com.pca.app.deviceactivity.usage-associations.owner.v1" }
    private static var unavailableKey: String { "com.pca.app.deviceactivity.usage-associations.unavailable.v1" }
    private static var ownershipValue: Data { Data("pca-usage-associations-v1".utf8) }
    private static var unavailableValue: Data { Data("association-authority-changed-during-write".utf8) }
    // The encoded 1 MiB cap is authoritative; large token/authority values can
    // exhaust it before reaching the 256-record ceiling. Revocation tombstones
    // remain to block stale reinstallation, so trusted pruning/rebuild is a
    // production lifecycle requirement rather than an implicit eviction.
    private static var maximumStateBytes: Int { 1_048_576 }
    private static var maximumRecords: Int { 256 }

    private let store: DeviceActivityUsageAssociationSnapshotPersistence
    private let coordination: DeviceActivityPolicyCoordination
    private let tokenDecoder = PropertyListDecoder()
    private var locallyUnavailable = false

    public init(store: DeviceActivityUsageAssociationSnapshotPersistence,
                coordination: DeviceActivityPolicyCoordination) {
        self.store = store
        self.coordination = coordination
    }

    /// Persists a mapping only after the caller's authority check succeeds.
    /// Revisions are caller supplied monotonic generations for this exact
    /// (family, device, logical-app) identity.
    public func installAcceptedAssociation(
        scope: DeviceActivityUsageAssociationScope,
        binding: DeviceActivityUsageSelectionBinding,
        authorityBinding: Data,
        revision: UInt64,
        revalidateAuthority: DeviceActivityUsageAssociationAuthorityRevalidator
    ) throws {
        try coordination.withExclusiveAccess {
            try revalidateAuthority(.init(scope: scope, logicalAppToken: binding.logicalAppToken,
                binding: binding, authorityBinding: authorityBinding, revision: revision))
            guard scope.isValid, binding.isValid, binding.logicalAppToken.utf8.count <= 256,
                  authorityBinding.count > 0, authorityBinding.count <= 8_192, revision > 0,
                  let token = try? tokenDecoder.decode(Token.self, from: binding.applicationTokenData),
                  binding.matches(Set([token]), logicalAppToken: binding.logicalAppToken) else {
                throw DeviceActivityUsageAssociationError.invalidAssociation
            }

            var state = try load()
            let matches = state.records.indices.filter {
                sameIdentity(state.records[$0], scope: scope, logicalAppToken: binding.logicalAppToken)
            }
            guard matches.count <= 1 else { throw DeviceActivityUsageAssociationError.unavailableState }
            if let index = matches.first {
                let current = state.records[index]
                if current.revoked {
                    guard revision > current.revision else { throw DeviceActivityUsageAssociationError.staleRevision }
                } else {
                    guard let currentBinding = current.binding else {
                        throw DeviceActivityUsageAssociationError.unavailableState
                    }
                    if revision == current.revision {
                        guard currentBinding == binding, current.authorityBinding == authorityBinding else {
                            throw DeviceActivityUsageAssociationError.conflictingReplay
                        }
                        try revalidateAuthority(.init(scope: scope, logicalAppToken: binding.logicalAppToken,
                            binding: binding, authorityBinding: authorityBinding, revision: revision))
                        return
                    }
                    guard revision > current.revision else { throw DeviceActivityUsageAssociationError.staleRevision }
                }
                state.records[index] = Record(scope: scope, logicalAppToken: binding.logicalAppToken,
                    binding: binding, authorityBinding: authorityBinding, revision: revision, revoked: false)
            } else {
                guard state.records.count < Self.maximumRecords else {
                    throw DeviceActivityUsageAssociationError.unavailableState
                }
                state.records.append(Record(scope: scope, logicalAppToken: binding.logicalAppToken,
                    binding: binding, authorityBinding: authorityBinding, revision: revision, revoked: false))
            }
            try persist(state)
            do {
                try revalidateAuthority(.init(scope: scope, logicalAppToken: binding.logicalAppToken,
                    binding: binding, authorityBinding: authorityBinding, revision: revision))
            } catch {
                try persistUnavailableLatch()
                throw error
            }
        }
    }

    /// Writes a monotonic tombstone. A later explicit re-authorization must
    /// advance the revision; stale writers cannot resurrect a revoked mapping.
    public func revokeAcceptedAssociation(
        scope: DeviceActivityUsageAssociationScope,
        logicalAppToken: String,
        authorityBinding: Data,
        revision: UInt64,
        revalidateAuthority: DeviceActivityUsageAssociationAuthorityRevalidator
    ) throws {
        try coordination.withExclusiveAccess {
            try revalidateAuthority(.init(scope: scope, logicalAppToken: logicalAppToken,
                binding: nil, authorityBinding: authorityBinding, revision: revision))
            guard scope.isValid, !logicalAppToken.isEmpty, logicalAppToken.utf8.count <= 256,
                  authorityBinding.count > 0, authorityBinding.count <= 8_192, revision > 0 else {
                throw DeviceActivityUsageAssociationError.invalidAssociation
            }
            var state = try load()
            let matches = state.records.indices.filter {
                sameIdentity(state.records[$0], scope: scope, logicalAppToken: logicalAppToken)
            }
            guard matches.count == 1, let index = matches.first else {
                throw DeviceActivityUsageAssociationError.unavailableState
            }
            let current = state.records[index]
            guard current.authorityBinding == authorityBinding else {
                throw DeviceActivityUsageAssociationError.authorityRejected
            }
            if current.revoked && revision == current.revision {
                try revalidateAuthority(.init(scope: scope, logicalAppToken: logicalAppToken,
                    binding: nil, authorityBinding: authorityBinding, revision: revision))
                return
            }
            guard revision > current.revision else {
                throw DeviceActivityUsageAssociationError.staleRevision
            }
            let revocationContext = DeviceActivityUsageAssociationAuthorityContext(
                scope: scope, logicalAppToken: logicalAppToken, binding: current.binding,
                authorityBinding: authorityBinding, revision: revision)
            try revalidateAuthority(revocationContext)
            state.records[index] = Record(scope: scope, logicalAppToken: logicalAppToken,
                binding: nil, authorityBinding: authorityBinding, revision: revision, revoked: true)
            try persist(state)
            try revalidateAuthority(revocationContext)
        }
    }

    /// Returns a binding only for the explicitly supplied current scope and
    /// authority. Missing, corrupt, revoked, stale, or ambiguous records never
    /// synthesize a mapping from a singleton picker selection.
    public func resolveAcceptedAssociation(
        scope: DeviceActivityUsageAssociationScope,
        logicalAppToken: String,
        selectedTokens: Set<Token>,
        currentAuthorityBinding: Data,
        revalidateAuthority: DeviceActivityUsageAssociationAuthorityRevalidator
    ) throws -> DeviceActivityUsageSelectionBinding? {
        try coordination.withExclusiveAccessContext { access in
            try resolveAcceptedAssociation(scope: scope, logicalAppToken: logicalAppToken,
                selectedTokens: selectedTokens, currentAuthorityBinding: currentAuthorityBinding,
                under: access, revalidateAuthority: revalidateAuthority)
        }
    }

    /// Resolves without reacquiring the coordinator, for synchronous callers
    /// already holding the same shared lock (such as policy installation).
    /// A foreign or expired access token is rejected before reading the store.
    public func resolveAcceptedAssociation(
        scope: DeviceActivityUsageAssociationScope,
        logicalAppToken: String,
        selectedTokens: Set<Token>,
        currentAuthorityBinding: Data,
        under access: DeviceActivityPolicyLockAccess,
        revalidateAuthority: DeviceActivityUsageAssociationAuthorityRevalidator
    ) throws -> DeviceActivityUsageSelectionBinding? {
        guard let result = try access.withActiveUse(for: coordination, {
            try resolveAcceptedAssociationUnderActiveAccess(scope: scope, logicalAppToken: logicalAppToken,
                selectedTokens: selectedTokens, currentAuthorityBinding: currentAuthorityBinding,
                revalidateAuthority: revalidateAuthority)
        }) else {
            throw DeviceActivityUsageAssociationError.invalidLockAccess
        }
        return result
    }

    private func resolveAcceptedAssociationUnderActiveAccess(
        scope: DeviceActivityUsageAssociationScope,
        logicalAppToken: String,
        selectedTokens: Set<Token>,
        currentAuthorityBinding: Data,
        revalidateAuthority: DeviceActivityUsageAssociationAuthorityRevalidator
    ) throws -> DeviceActivityUsageSelectionBinding? {
        try revalidateAuthority(.init(scope: scope, logicalAppToken: logicalAppToken,
            binding: nil, authorityBinding: currentAuthorityBinding, revision: nil))
        guard scope.isValid, !logicalAppToken.isEmpty, logicalAppToken.utf8.count <= 256,
              currentAuthorityBinding.count > 0, currentAuthorityBinding.count <= 8_192 else {
            throw DeviceActivityUsageAssociationError.invalidAssociation
        }
        let state = try load()
        let matches = state.records.filter {
            sameIdentity($0, scope: scope, logicalAppToken: logicalAppToken)
        }
        guard matches.count <= 1 else { throw DeviceActivityUsageAssociationError.unavailableState }
        guard let record = matches.first else { return nil }
        try revalidateAuthority(.init(scope: scope, logicalAppToken: logicalAppToken,
            binding: record.binding, authorityBinding: currentAuthorityBinding, revision: record.revision))
        guard !record.revoked, record.authorityBinding == currentAuthorityBinding,
              let binding = record.binding,
              binding.matches(selectedTokens, logicalAppToken: logicalAppToken) else { return nil }
        try revalidateAuthority(.init(scope: scope, logicalAppToken: logicalAppToken,
            binding: binding, authorityBinding: currentAuthorityBinding, revision: record.revision))
        return binding
    }

    private func sameIdentity(_ record: Record, scope: DeviceActivityUsageAssociationScope,
                              logicalAppToken: String) -> Bool {
        record.scope.familyId.utf8.elementsEqual(scope.familyId.utf8) &&
            record.scope.deviceId.utf8.elementsEqual(scope.deviceId.utf8) &&
            record.logicalAppToken.utf8.elementsEqual(logicalAppToken.utf8)
    }

    private func load() throws -> State {
        guard !locallyUnavailable, store.read(forKey: Self.unavailableKey) == nil else {
            throw DeviceActivityUsageAssociationError.unavailableState
        }
        let owner = store.read(forKey: Self.ownershipKey)
        let data = store.read(forKey: Self.stateKey)
        if owner == nil && data == nil { return State(schemaVersion: 1, records: []) }
        guard owner == Self.ownershipValue, let data, data.count <= Self.maximumStateBytes,
              store.read(forKey: Self.ownershipKey) == Self.ownershipValue,
              store.read(forKey: Self.stateKey) == data,
              let state = try? JSONDecoder().decode(State.self, from: data),
              state.schemaVersion == 1, state.records.count <= Self.maximumRecords else {
            throw DeviceActivityUsageAssociationError.unavailableState
        }
        for record in state.records {
            guard record.scope.isValid, !record.logicalAppToken.isEmpty,
                  record.logicalAppToken.utf8.count <= 256, record.revision > 0,
                  record.authorityBinding.count > 0, record.authorityBinding.count <= 8_192 else {
                throw DeviceActivityUsageAssociationError.unavailableState
            }
            if record.revoked {
                guard record.binding == nil else { throw DeviceActivityUsageAssociationError.unavailableState }
            } else {
                guard let binding = record.binding, binding.isValid,
                      binding.logicalAppToken.utf8.elementsEqual(record.logicalAppToken.utf8),
                      (try? tokenDecoder.decode(Token.self, from: binding.applicationTokenData)) != nil else {
                    throw DeviceActivityUsageAssociationError.unavailableState
                }
            }
        }
        for index in state.records.indices {
            for other in state.records.indices where other > index {
                guard !sameIdentity(state.records[index], scope: state.records[other].scope,
                                    logicalAppToken: state.records[other].logicalAppToken) else {
                    throw DeviceActivityUsageAssociationError.unavailableState
                }
            }
        }
        return state
    }

    private func persist(_ state: State) throws {
        let data: Data
        do { data = try JSONEncoder().encode(state) }
        catch { throw DeviceActivityUsageAssociationError.persistenceFailed }
        guard data.count <= Self.maximumStateBytes else { throw DeviceActivityUsageAssociationError.unavailableState }
        do {
            try store.writeAtomically(Self.ownershipValue, forKey: Self.ownershipKey)
            guard store.read(forKey: Self.ownershipKey) == Self.ownershipValue else {
                throw DeviceActivityUsageAssociationError.persistenceFailed
            }
            try store.writeAtomically(data, forKey: Self.stateKey)
            guard store.read(forKey: Self.stateKey) == data,
                  store.read(forKey: Self.ownershipKey) == Self.ownershipValue else {
                throw DeviceActivityUsageAssociationError.persistenceFailed
            }
        } catch {
            if error is DeviceActivityUsageAssociationError { throw error }
            throw DeviceActivityUsageAssociationError.persistenceFailed
        }
    }

    /// A failed post-write authority check attempts durable invalidation in
    /// order: poison key, ownership-marker removal, then invalid snapshot
    /// replacement. If every storage path fails, this instance stays
    /// unavailable; recreated readers must reject the exact old authority
    /// context through their required trusted revalidator.
    private func persistUnavailableLatch() throws {
        locallyUnavailable = true
        do {
            try store.writeAtomically(Self.unavailableValue, forKey: Self.unavailableKey)
            guard store.read(forKey: Self.unavailableKey) == Self.unavailableValue else {
                throw DeviceActivityUsageAssociationError.persistenceFailed
            }
        } catch {
            store.remove(forKey: Self.ownershipKey)
            if store.read(forKey: Self.ownershipKey) == nil {
                guard store.read(forKey: Self.stateKey) != nil else {
                    throw DeviceActivityUsageAssociationError.persistenceFailed
                }
                return
            }
            // If the marker cannot be removed, replace the active snapshot with
            // an invalid fail-closed value using the same atomic key operation.
            do {
                try store.writeAtomically(Self.unavailableValue, forKey: Self.stateKey)
            } catch {
                throw DeviceActivityUsageAssociationError.persistenceFailed
            }
            guard store.read(forKey: Self.stateKey) == Self.unavailableValue,
                  store.read(forKey: Self.ownershipKey) == Self.ownershipValue else {
                throw DeviceActivityUsageAssociationError.persistenceFailed
            }
        }
    }
}

/// Separate from diagnostic callback history. All operations must run under the shared
/// policy coordination lock; no nested flock acquisition or in-memory authority fallback.
public final class DeviceActivityUsageLowerBoundStore<Token: Hashable & Codable> {
    private struct Record: Codable {
        let binding: DeviceActivityUsageSelectionBinding
        let localDate: String
        let zone: String
        let dayStart: Date
        let dayEnd: Date
        var minutes: Int
    }
    private struct State: Codable { let schemaVersion: Int; var records: [Record] }
    private struct Pending: Codable { let plan: DeviceActivityUsageDayPlan; let minutes: Int }
    private let store: OpaqueBlobStore
    private let key = "com.pca.app.deviceactivity.usage-lower-bound.v1"
    public init(store: OpaqueBlobStore) { self.store = store }

    private func installedState(for plan: DeviceActivityUsageDayPlan) -> DeviceActivityMonitorInstallationState? {
        guard let data = store.read(forKey: deviceActivityMonitorInstallationStorageKey),
              let installation = DeviceActivityMonitorInstallation.decodeValidated(data),
              installation.usageDayPlan == plan,
              store.read(forKey: deviceActivityMonitorInstallationStorageKey) == data else { return nil }
        let pointer = store.read(forKey: "activeActivityId")
        if installation.state == .active && pointer == Data(installation.policyActivityId.utf8) { return .active }
        if installation.state == .starting && pointer == nil { return .starting }
        return nil
    }

    private func sameSelection(_ a: DeviceActivityUsageSelectionBinding, _ b: DeviceActivityUsageSelectionBinding) -> Bool {
        guard a.logicalAppToken.utf8.elementsEqual(b.logicalAppToken.utf8),
              let first = try? PropertyListDecoder().decode(Token.self, from: a.applicationTokenData),
              let second = try? PropertyListDecoder().decode(Token.self, from: b.applicationTokenData) else { return false }
        return first == second
    }
    private func matches(_ record: Record, _ plan: DeviceActivityUsageDayPlan) -> Bool {
        sameSelection(record.binding, plan.binding) && record.localDate == plan.localDate &&
            record.zone.utf8.elementsEqual(plan.policyTimeZoneIdentifier.utf8) &&
            record.dayStart == plan.dayStartUtc && record.dayEnd == plan.dayEndUtc
    }
    private func load() throws -> State {
        guard let data = store.read(forKey: key) else { return State(schemaVersion: 1, records: []) }
        guard data.count <= 131_072, let state = try? JSONDecoder().decode(State.self, from: data),
              state.schemaVersion == 1, state.records.count <= 8 else { throw DeviceActivityUsageError.unavailableState }
        for record in state.records {
            guard record.binding.isValid, let zone = TimeZone(identifier: record.zone),
                  (1...DeviceActivityUsagePlanner.maximumMinutes).contains(record.minutes),
                  record.dayStart.timeIntervalSince1970.isFinite, record.dayEnd.timeIntervalSince1970.isFinite,
                  record.dayEnd > record.dayStart,
                  ScheduleEngine.localDateString(record.dayStart, timeZone: zone) == record.localDate,
                  (try? PropertyListDecoder().decode(Token.self, from: record.binding.applicationTokenData)) != nil else {
                throw DeviceActivityUsageError.unavailableState
            }
            var calendar = Calendar(identifier: .gregorian); calendar.timeZone = zone
            guard let interval = calendar.dateInterval(of: .day, for: record.dayStart),
                  interval.start == record.dayStart, interval.end == record.dayEnd else {
                throw DeviceActivityUsageError.unavailableState
            }
        }
        for i in state.records.indices {
            for j in state.records.indices where j > i {
                let a = state.records[i], b = state.records[j]
                guard !(a.localDate == b.localDate && a.zone == b.zone && sameSelection(a.binding, b.binding)) else {
                    throw DeviceActivityUsageError.unavailableState
                }
            }
        }
        return state
    }
    public func lowerBound(for plan: DeviceActivityUsageDayPlan) throws -> Int? {
        guard plan.isValid else { throw DeviceActivityUsageError.malformedPlan }
        return try load().records.first(where: { matches($0, plan) })?.minutes
    }
    @discardableResult public func record(plan: DeviceActivityUsageDayPlan, activityId: String,
                                         eventId: String, at: Date, deviceTimeZone: TimeZone) throws -> Int {
        guard installedState(for: plan) == .active,
              plan.contains(at, deviceTimeZone: deviceTimeZone), plan.monitorActivityId == activityId,
              let threshold = plan.thresholds.first(where: { $0.eventId == eventId }) else { throw DeviceActivityUsageError.staleCallback }
        return try merge(plan: plan, minutes: threshold.minutes, pruningAt: at)
    }
    private func merge(plan: DeviceActivityUsageDayPlan, minutes: Int, pruningAt at: Date) throws -> Int {
        var state = try load()
        if let index = state.records.firstIndex(where: { matches($0, plan) }) {
            state.records[index].minutes = max(state.records[index].minutes, minutes)
        } else {
            // Never evict evidence for an unexpired day just to create a new identity.
            state.records.removeAll { $0.dayEnd <= at }
            guard state.records.count < 8 else { throw DeviceActivityUsageError.unavailableState }
            state.records.append(Record(binding: plan.binding, localDate: plan.localDate,
                zone: plan.policyTimeZoneIdentifier, dayStart: plan.dayStartUtc, dayEnd: plan.dayEndUtc, minutes: minutes))
        }
        let data = try JSONEncoder().encode(state)
        guard data.count <= 131_072 else { throw DeviceActivityUsageError.unavailableState }
        try store.write(data, forKey: key)
        guard store.read(forKey: key) == data else { throw DeviceActivityUsageError.persistenceFailed }
        return state.records.first(where: { matches($0, plan) })!.minutes
    }

    /// Starting callbacks cannot publish observations from an uncommitted installation.
    public func stage(plan: DeviceActivityUsageDayPlan, activityId: String, eventId: String,
                      at: Date, deviceTimeZone: TimeZone) throws {
        guard installedState(for: plan) == .starting,
              plan.contains(at, deviceTimeZone: deviceTimeZone), plan.monitorActivityId == activityId,
              let threshold = plan.thresholds.first(where: { $0.eventId == eventId }) else { throw DeviceActivityUsageError.staleCallback }
        let previous = try pending(for: plan)
        let value = Pending(plan: plan, minutes: max(previous?.minutes ?? 0, threshold.minutes))
        let data = try JSONEncoder().encode(value)
        let pendingKey = "usage.pending." + plan.generation
        try store.write(data, forKey: pendingKey)
        guard store.read(forKey: pendingKey) == data else { throw DeviceActivityUsageError.persistenceFailed }
    }
    private func pending(for plan: DeviceActivityUsageDayPlan) throws -> Pending? {
        guard let data = store.read(forKey: "usage.pending." + plan.generation) else { return nil }
        guard data.count <= 32_768, let value = try? JSONDecoder().decode(Pending.self, from: data),
              value.plan == plan, value.plan.isValid, plan.thresholds.contains(where: { $0.minutes == value.minutes }) else {
            throw DeviceActivityUsageError.unavailableState
        }
        return value
    }
    /// Caller must first confirm the active manifest and active pointer under the shared lock.
    public func activate(plan: DeviceActivityUsageDayPlan) throws {
        guard plan.isValid, installedState(for: plan) == .active else { throw DeviceActivityUsageError.staleCallback }
        guard let staged = try pending(for: plan) else { return }
        _ = try merge(plan: plan, minutes: staged.minutes, pruningAt: plan.dayStartUtc)
        store.remove(forKey: "usage.pending." + plan.generation)
    }
    public func discardPending(generation: String) {
        guard UUID(uuidString: generation) != nil else { return }
        store.remove(forKey: "usage.pending." + generation)
    }
}

/// Compose an evaluation copy only; authenticated policy bytes remain immutable.
public enum DeviceActivityUsageEvaluation {
    public static func input(policy: DecodedSchedulePolicy, now: Date, lowerBoundMinutes: Int?,
                             coverageAvailable: Bool) -> ScheduleEvaluationInput {
        let day = ScheduleEngine.localDateString(now, timeZone: policy.timeZone)
        let daily: DailyAppLimit?
        if let limit = policy.dailyLimit, let observed = lowerBoundMinutes,
           (0...DeviceActivityUsagePlanner.maximumMinutes).contains(observed) {
            daily = DailyAppLimit(appScope: limit.appScope, limitMinutes: limit.limitMinutes,
                usedMinutesToday: max(limit.anchorLocalDate == day ? limit.usedMinutesToday : 0, observed), anchorLocalDate: day)
        } else { daily = policy.dailyLimit }
        return ScheduleEvaluationInput(nowUtc: now, timeZone: policy.timeZone, appToken: policy.appToken,
            windows: policy.windows, bonusGrants: policy.bonusGrants, exceptions: policy.exceptions,
            dailyLimit: daily, enforcementCapability: policy.enforcementCapability == .enforced && policy.dailyLimit != nil && !coverageAvailable
                ? .degraded : policy.enforcementCapability)
    }
}

/// Shared mutation boundary. Failed attribution or a rejected emergency floor
/// leaves existing shields untouched; observed usage never mutates signed policy.
public enum DeviceActivityUsageEnforcement {
    @discardableResult public static func reconcile<Token: Hashable>(
        policy: DecodedSchedulePolicy, now: Date, applications: Set<Token>, protectedApplications: Set<Token>,
        coverageAvailable: Bool, loadLowerBound: () throws -> Int?,
        apply: (Set<Token>) throws -> Void, remove: () -> Void
    ) throws -> Bool {
        guard case .accepted = ShieldPolicyValidator<Token>(protectedApplicationTokens: protectedApplications,
            protectedCategoryTokens: []).validate(applications: applications, categories: [], domains: []) else { return false }
        let observed: Int?
        do { observed = try loadLowerBound() } catch { return false }
        let decision = ScheduleEngine.evaluate(DeviceActivityUsageEvaluation.input(policy: policy,
            now: now, lowerBoundMinutes: observed, coverageAvailable: coverageAvailable))
        if decision.isRestrictive || decision.kind == .enforcementUnavailable { try apply(applications) }
        else { remove() }
        return true
    }
}

/// Caller holds the same cross-process lock used for registration and shield mutation.
/// A supplied obsolete plan is insufficient: resolve the current immutable manifest first.
public struct DeviceActivityUsageCallbackProcessor<Token: Hashable & Codable> {
    private let store: OpaqueBlobStore
    public init(store: OpaqueBlobStore) { self.store = store }
    @discardableResult public func consume(activityId: String, eventId: String, at: Date,
                                          deviceTimeZone: TimeZone) throws -> Bool {
        guard let data = store.read(forKey: deviceActivityMonitorInstallationStorageKey),
              let installation = DeviceActivityMonitorInstallation.decodeValidated(data),
              installation.state != .invalidated, let plan = installation.usageDayPlan,
              plan.monitorActivityId == activityId,
              let policy = StoredDeviceActivityPolicyLoader<Token>(scheduleStore: store, tokenStore: store)
                .load(activityId: installation.policyActivityId, storageGeneration: installation.payloadStorageGeneration),
              plan.binding.matches(policy.applicationTokens, logicalAppToken: policy.schedule.appToken),
              plan.matches(policy: policy.schedule),
              store.read(forKey: deviceActivityMonitorInstallationStorageKey) == data else {
            throw DeviceActivityUsageError.staleCallback
        }
        let usage = DeviceActivityUsageLowerBoundStore<Token>(store: store)
        if installation.state == .starting {
            guard store.read(forKey: "activeActivityId") == nil else { throw DeviceActivityUsageError.staleCallback }
            try usage.stage(plan: plan, activityId: activityId, eventId: eventId, at: at, deviceTimeZone: deviceTimeZone)
            return false
        }
        guard store.read(forKey: "activeActivityId") == Data(installation.policyActivityId.utf8) else {
            throw DeviceActivityUsageError.staleCallback
        }
        try usage.activate(plan: plan)
        _ = try usage.record(plan: plan, activityId: activityId, eventId: eventId, at: at, deviceTimeZone: deviceTimeZone)
        return true
    }
}
