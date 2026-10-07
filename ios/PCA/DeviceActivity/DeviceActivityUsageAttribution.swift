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
