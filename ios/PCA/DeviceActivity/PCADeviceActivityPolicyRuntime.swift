import Foundation
#if canImport(DeviceActivity) && canImport(FamilyControls) && canImport(ManagedSettings)
import DeviceActivity
import FamilyControls
import ManagedSettings
#endif

/// The result of the host-side policy handoff. `applied` means the validated
/// policy was persisted, DeviceActivity monitoring was scheduled, and the
/// current decision was handed to ManagedSettings. It does not mean the
/// backend has acknowledged the state; that remains a separate sync concern.
public enum PCAProtectionPolicyApplicationResult: Equatable {
    case applied
    case scheduledOnly
    case degraded
}

public enum PCAProtectionPolicyApplicationError: Error, Equatable {
    case authorizationRequired
    case malformedPolicy
    case unsafePolicy
    case frameworkUnavailable
    case persistenceFailed
    case schedulingFailed
    case unsupportedSchedule
}

/// This is the post-crypto application boundary. Callers may pass data here
/// only after the family envelope/signature/decryption/authorization pipeline
/// has accepted it. This type performs structural policy validation again at
/// the last local use point, persists the exact validated bytes for the
/// extensions, schedules DeviceActivity, and applies the current decision.
public protocol PCAProtectionPolicyRuntime {
    func applyVerifiedPolicy(
        scheduleData: Data,
        applicationTokenData: Data,
        protectedApplicationTokenData: Data?,
        now: Date
    ) throws -> PCAProtectionPolicyApplicationResult

    func clearPolicy(activityId: String)
    func callbackHealth(now: Date) -> DeviceActivityCallbackHealth
    func usageMonitorStatus(now: Date) -> DeviceActivityUsageMonitorStatus
    func renewInstalledUsageMonitor(now: Date) throws -> PCAProtectionPolicyApplicationResult
}

public extension PCAProtectionPolicyRuntime {
    func usageMonitorStatus(now: Date) -> DeviceActivityUsageMonitorStatus { .unavailable }
    func renewInstalledUsageMonitor(now: Date) throws -> PCAProtectionPolicyApplicationResult {
        throw PCAProtectionPolicyApplicationError.frameworkUnavailable
    }
}

public struct PCAUnavailableProtectionPolicyRuntime: PCAProtectionPolicyRuntime {
    public init() {}

    public func applyVerifiedPolicy(
        scheduleData: Data,
        applicationTokenData: Data,
        protectedApplicationTokenData: Data?,
        now: Date
    ) throws -> PCAProtectionPolicyApplicationResult {
        throw PCAProtectionPolicyApplicationError.frameworkUnavailable
    }

    public func clearPolicy(activityId: String) {}
    public func callbackHealth(now: Date) -> DeviceActivityCallbackHealth { .unknown }
}

#if canImport(DeviceActivity) && canImport(FamilyControls) && canImport(ManagedSettings)
public protocol PCADeviceActivityShieldEnforcing {
    func apply(applications: Set<ApplicationToken>, protectedApplications: Set<ApplicationToken>) throws
    func removeAll()
}

public struct SystemPCADeviceActivityShieldEnforcer: PCADeviceActivityShieldEnforcing {
    public init() {}
    public func apply(applications: Set<ApplicationToken>, protectedApplications: Set<ApplicationToken>) throws {
        try ManagedSettingsAdapter(protectedApplicationTokens: protectedApplications,
            protectedCategoryTokens: []).apply(applications: applications, categories: [])
    }
    public func removeAll() {
        ManagedSettingsAdapter(protectedApplicationTokens: [], protectedCategoryTokens: []).removeAll()
    }
}

/// Narrow scheduler port so policy persistence/application can be tested
/// without invoking Apple's process-bound DeviceActivity center.
public protocol PCADeviceActivityScheduler {
    func start(activityId: String, calendar: Calendar) throws
    func startBoundary(activityId: String, trigger: DeviceActivityBoundaryTrigger) throws
    func stop(activityId: String)
    func ownedMonitorActivityIds() -> [String]
    func startUsage(plan: DeviceActivityUsageDayPlan, applications: Set<ApplicationToken>) throws
}
public extension PCADeviceActivityScheduler {
    func startUsage(plan: DeviceActivityUsageDayPlan, applications: Set<ApplicationToken>) throws {
        throw DeviceActivityUsageError.unsupportedHistoricalActivity
    }
}

public final class SystemPCADeviceActivityScheduler: PCADeviceActivityScheduler {
    private let center: DeviceActivityCenter

    public init(center: DeviceActivityCenter = DeviceActivityCenter()) {
        self.center = center
    }

    public func start(activityId: String, calendar: Calendar) throws {
        // The schedule is deliberately a technical all-day callback envelope.
        // ScheduleEngine remains the only authority for time-of-day, weekday,
        // exception, bonus, and daily-limit semantics inside each callback.
        try center.startMonitoring(
            DeviceActivityName(activityId),
            during: DeviceActivityScheduleMapper.monitoringSchedule(calendar: calendar),
            events: [:]
        )
    }

    public func startBoundary(activityId: String, trigger: DeviceActivityBoundaryTrigger) throws {
        try center.startMonitoring(DeviceActivityName(activityId), during: DeviceActivityScheduleMapper.boundarySchedule(for: trigger), events: [:])
    }

    public func startUsage(plan: DeviceActivityUsageDayPlan, applications: Set<ApplicationToken>) throws {
        guard #available(iOS 17.4, *), plan.isValid,
              plan.binding.matches(applications, logicalAppToken: plan.binding.logicalAppToken),
              plan.deviceTimeZoneIdentifier.utf8.elementsEqual(TimeZone.current.identifier.utf8),
              let zone = TimeZone(identifier: plan.deviceTimeZoneIdentifier) else {
            throw DeviceActivityUsageError.unsupportedHistoricalActivity
        }
        var calendar = Calendar(identifier: .gregorian); calendar.timeZone = zone
        func components(_ date: Date) -> DateComponents {
            var value = calendar.dateComponents([.year, .month, .day, .hour, .minute, .second], from: date)
            value.calendar = calendar; value.timeZone = zone; return value
        }
        let start = components(plan.accountingStartUtc), end = components(plan.dayEndUtc)
        guard calendar.date(from: start) == plan.accountingStartUtc, calendar.date(from: end) == plan.dayEndUtc else {
            throw DeviceActivityUsageError.malformedPlan
        }
        var events: [DeviceActivityEvent.Name: DeviceActivityEvent] = [:]
        for threshold in plan.thresholds {
            events[DeviceActivityEvent.Name(threshold.eventId)] = DeviceActivityEvent(
                applications: applications, categories: [], webDomains: [],
                threshold: DateComponents(minute: threshold.minutes), includesPastActivity: true)
        }
        try center.startMonitoring(DeviceActivityName(plan.monitorActivityId),
            during: DeviceActivitySchedule(intervalStart: start, intervalEnd: end, repeats: false), events: events)
    }

    public func ownedMonitorActivityIds() -> [String] {
        center.activities.map(\.rawValue).filter { $0.hasPrefix("pca-monitor-") && UUID(uuidString: String($0.dropFirst("pca-monitor-".count))) != nil }
    }
    public func stop(activityId: String) {
        center.stopMonitoring([DeviceActivityName(activityId)])
    }
}

public final class PCAProductionProtectionPolicyRuntime: PCAProtectionPolicyRuntime {
    private let authorizationIsApproved: () -> Bool
    private let scheduler: PCADeviceActivityScheduler
    private let blobStore: OpaqueBlobStore
    private let callbackLog: CallbackObservationLog?
    private let plistDecoder = PropertyListDecoder()
    private let installationEncoder = JSONEncoder()
    private let installationClock: () -> Date
    private let mutationLock = NSRecursiveLock()
    private let policyCoordination: DeviceActivityPolicyCoordination
    private let usageBindingProvider: (DecodedSchedulePolicy, Set<ApplicationToken>) -> DeviceActivityUsageSelectionBinding?
    private let deviceTimeZone: () -> TimeZone
    private let shieldEnforcer: PCADeviceActivityShieldEnforcing

    public init(
        authorizationIsApproved: @escaping () -> Bool,
        scheduler: PCADeviceActivityScheduler = SystemPCADeviceActivityScheduler(),
        blobStore: OpaqueBlobStore,
        callbackLog: CallbackObservationLog? = nil,
        installationClock: @escaping () -> Date = Date.init,
        policyCoordination: DeviceActivityPolicyCoordination = LocalDeviceActivityPolicyCoordination(),
        usageBindingProvider: @escaping (DecodedSchedulePolicy, Set<ApplicationToken>) -> DeviceActivityUsageSelectionBinding? = { _, _ in nil },
        deviceTimeZone: @escaping () -> TimeZone = { .current },
        shieldEnforcer: PCADeviceActivityShieldEnforcing = SystemPCADeviceActivityShieldEnforcer()
    ) {
        self.authorizationIsApproved = authorizationIsApproved
        self.scheduler = scheduler
        self.blobStore = blobStore
        self.callbackLog = callbackLog
        self.installationClock = installationClock
        self.policyCoordination = policyCoordination
        self.usageBindingProvider = usageBindingProvider
        self.deviceTimeZone = deviceTimeZone
        self.shieldEnforcer = shieldEnforcer
        // Process death during registration must not leave a partially owned
        // set consuming slots or claiming health after host reconstruction.
        try? policyCoordination.withExclusiveAccess {
            if let incomplete = currentInstallation(), incomplete.state != .active { invalidate(incomplete) }
        }
    }

    public func applyVerifiedPolicy(
        scheduleData: Data,
        applicationTokenData: Data,
        protectedApplicationTokenData: Data?,
        now: Date
    ) throws -> PCAProtectionPolicyApplicationResult {
        do {
            return try policyCoordination.withExclusiveAccess {
                try applyPolicyUnderLock(scheduleData: scheduleData, applicationTokenData: applicationTokenData, protectedApplicationTokenData: protectedApplicationTokenData, now: now)
            }
        } catch let error as PCAProtectionPolicyApplicationError { throw error }
        catch { throw PCAProtectionPolicyApplicationError.persistenceFailed }
    }

    private func applyPolicyUnderLock(scheduleData: Data, applicationTokenData: Data, protectedApplicationTokenData: Data?, now: Date) throws -> PCAProtectionPolicyApplicationResult {
        mutationLock.lock()
        defer { mutationLock.unlock() }
        guard authorizationIsApproved() else {
            throw PCAProtectionPolicyApplicationError.authorizationRequired
        }
        guard case .success(let policy) = PolicySyncDecoder.decode(scheduleData) else {
            throw PCAProtectionPolicyApplicationError.malformedPolicy
        }
        guard let applicationTokens = try? plistDecoder.decode(Set<ApplicationToken>.self, from: applicationTokenData) else {
            throw PCAProtectionPolicyApplicationError.malformedPolicy
        }

        let protectedTokens: Set<ApplicationToken>
        if let protectedApplicationTokenData = protectedApplicationTokenData {
            guard let decoded = try? plistDecoder.decode(Set<ApplicationToken>.self, from: protectedApplicationTokenData) else {
                throw PCAProtectionPolicyApplicationError.malformedPolicy
            }
            protectedTokens = decoded
        } else {
            protectedTokens = []
        }

        let validator = ShieldPolicyValidator<ApplicationToken>(
            protectedApplicationTokens: protectedTokens,
            protectedCategoryTokens: []
        )
        guard case .accepted = validator.validate(applications: applicationTokens, categories: [], domains: []) else {
            throw PCAProtectionPolicyApplicationError.unsafePolicy
        }

        let planningTime = installationClock()
        let triggers: [DeviceActivityBoundaryTrigger]
        do {
            triggers = try DeviceActivityScheduleMapper.boundaryTriggers(for: policy, now: planningTime)
        } catch {
            // Reject before invalidating a working generation. No partial
            // coverage or older policy is relabeled as this new application.
            throw PCAProtectionPolicyApplicationError.unsupportedSchedule
        }
        let generation = UUID().uuidString.lowercased()
        let boundaries = triggers.map { DeviceActivityBoundaryMonitor(activityId: "pca-monitor-\(UUID().uuidString.lowercased())", trigger: $0) }
        let usagePlan: DeviceActivityUsageDayPlan?
        if policy.dailyLimit != nil, let binding = usageBindingProvider(policy, applicationTokens),
           binding.matches(applicationTokens, logicalAppToken: policy.appToken) {
            if #available(iOS 17.4, *) {
                do {
                    usagePlan = try DeviceActivityUsagePlanner.plan(policy: policy, binding: binding,
                        generation: generation, now: planningTime, deviceTimeZone: deviceTimeZone(),
                        historicalActivitySupported: true, otherMonitorCount: boundaries.count + 1)
                } catch { throw PCAProtectionPolicyApplicationError.unsupportedSchedule }
            } else { usagePlan = nil }
        } else { usagePlan = nil } // No inferred association or fabricated zero-usage evidence.
        let monitoringCalendar = DeviceActivityScheduleMapper.monitoringCalendar()
        let previousInstallation = currentInstallation()
        let previousActiveId = currentActiveActivityId()
        if usagePlan == nil, let limit = policy.dailyLimit, limit.appScope.includes(policy.appToken),
           let prior = previousInstallation?.usageDayPlan,
           planningTime >= prior.dayStartUtc, planningTime < prior.dayEndUtc,
           prior.policyTimeZoneIdentifier.utf8.elementsEqual(policy.timeZone.identifier.utf8),
           prior.binding.matches(applicationTokens, logicalAppToken: policy.appToken) {
            // A schema-2 replacement would forget this day's attribution on the
            // next extension callback. Keep the working generation intact until
            // an explicit binding can support the replacement usage monitor.
            throw PCAProtectionPolicyApplicationError.unsupportedSchedule
        }
        blobStore.remove(forKey: deviceActivityMonitorInstallationStorageKey)
        blobStore.remove(forKey: "activeActivityId")
        guard blobStore.read(forKey: deviceActivityMonitorInstallationStorageKey) == nil,
              blobStore.read(forKey: "activeActivityId") == nil else { throw PCAProtectionPolicyApplicationError.persistenceFailed }
        if let previousInstallation {
            retire(previousInstallation)
        } else if let previousActiveId {
            scheduler.stop(activityId: previousActiveId)
            removePayloads(policyActivityId: previousActiveId, generation: nil)
        }

        // Immutable generation slots prevent a callback that already read an
        // old manifest from mixing a new policy with an older token safety floor.
        // Reclaim orphaned generated OS names when metadata was lost/corrupt.
        // Other app activities are preserved; no broad stopMonitoring([]).
        for id in scheduler.ownedMonitorActivityIds() { scheduler.stop(activityId: id) }
        let suffix = "." + generation
        do {
            try blobStore.write(scheduleData, forKey: "schedule.\(policy.activityId)\(suffix)")
            try blobStore.write(applicationTokenData, forKey: "applicationTokens.\(policy.activityId)\(suffix)")
            let floor = try protectedApplicationTokenData ?? PropertyListEncoder().encode(Set<ApplicationToken>())
            try blobStore.write(floor, forKey: "protectedApplicationTokens\(suffix)")
            guard blobStore.read(forKey: "schedule.\(policy.activityId)\(suffix)") == scheduleData,
                  blobStore.read(forKey: "applicationTokens.\(policy.activityId)\(suffix)") == applicationTokenData,
                  blobStore.read(forKey: "protectedApplicationTokens\(suffix)") == floor else {
                throw PCAProtectionPolicyApplicationError.persistenceFailed
            }
        } catch {
            removePayloads(policyActivityId: policy.activityId, generation: generation)
            throw PCAProtectionPolicyApplicationError.persistenceFailed
        }
        let installation = DeviceActivityMonitorInstallation(
            policyActivityId: policy.activityId,
            monitorActivityId: "pca-monitor-\(UUID().uuidString.lowercased())",
            generation: generation,
            installedAtUtc: installationClock(),
            timeZoneIdentifier: monitoringCalendar.timeZone.identifier,
            state: .starting,
            schemaVersion: usagePlan == nil ? 2 : 3,
            boundaryMonitors: boundaries,
            usageDayPlan: usagePlan
        )
        do {
            try writeInstallation(installation)
        } catch {
            invalidate(installation)
            throw PCAProtectionPolicyApplicationError.persistenceFailed
        }
        do {
            try scheduler.start(activityId: installation.monitorActivityId, calendar: monitoringCalendar)
            for boundary in boundaries {
                try scheduler.startBoundary(activityId: boundary.activityId, trigger: boundary.trigger)
            }
            if let usagePlan { try scheduler.startUsage(plan: usagePlan, applications: applicationTokens) }
        } catch {
            // Stop every staged name, including a throwing registration that
            // may have partially reached the OS. stop is idempotent per name.
            invalidate(installation)
            throw PCAProtectionPolicyApplicationError.schedulingFailed
        }
        do {
            // Publish the active pointer last. Until both writes succeed,
            // extension callbacks cannot mutate shields under this generation.
            try writeInstallation(installation.confirmingActive())
            try blobStore.write(Data(policy.activityId.utf8), forKey: "activeActivityId")
            guard blobStore.read(forKey: "activeActivityId") == Data(policy.activityId.utf8),
                  currentInstallation() == installation.confirmingActive() else {
                throw PCAProtectionPolicyApplicationError.persistenceFailed
            }
        } catch {
            invalidate(installation)
            throw PCAProtectionPolicyApplicationError.persistenceFailed
        }

        let evaluationTime = installationClock()
        var usageAvailable = false
        var observationPlan: DeviceActivityUsageDayPlan?
        let retainedPlan = usagePlan ?? previousInstallation?.usageDayPlan
        if let retainedPlan, policy.dailyLimit != nil,
           retainedPlan.binding.matches(applicationTokens, logicalAppToken: policy.appToken),
           retainedPlan.policyTimeZoneIdentifier.utf8.elementsEqual(policy.timeZone.identifier.utf8),
           evaluationTime >= retainedPlan.dayStartUtc, evaluationTime < retainedPlan.dayEndUtc {
            observationPlan = retainedPlan
            usageAvailable = usagePlan != nil && retainedPlan.coverage == .wholePolicyDayPlanned &&
                retainedPlan.contains(evaluationTime, deviceTimeZone: deviceTimeZone())
        }
        guard try DeviceActivityUsageEnforcement.reconcile(policy: policy, now: evaluationTime,
            applications: applicationTokens, protectedApplications: protectedTokens,
            coverageAvailable: usageAvailable, loadLowerBound: {
                guard let observationPlan else { return nil }
                let usageStore = DeviceActivityUsageLowerBoundStore<ApplicationToken>(store: self.blobStore)
                if let usagePlan { try usageStore.activate(plan: usagePlan) }
                return try usageStore.lowerBound(for: observationPlan)
            },
            apply: { try self.shieldEnforcer.apply(applications: $0, protectedApplications: protectedTokens) },
            remove: { self.shieldEnforcer.removeAll() }) else { return .degraded }

        if policy.dailyLimit != nil && !usageAvailable { return .degraded }
        switch policy.enforcementCapability {
        case .enforced:
            return .applied
        case .degraded, .unavailable:
            return .degraded
        }
    }

    /// Planned registration status only; this does not certify callback delivery.
    public func usageMonitorStatus(now: Date) -> DeviceActivityUsageMonitorStatus {
        return (try? policyCoordination.withExclusiveAccess {
            guard let installation = currentInstallation(), installation.state == .active,
                  currentActiveActivityId() == installation.policyActivityId,
                  let plan = installation.usageDayPlan,
                  let policy = StoredDeviceActivityPolicyLoader<ApplicationToken>(scheduleStore: blobStore, tokenStore: blobStore)
                    .load(activityId: installation.policyActivityId, storageGeneration: installation.payloadStorageGeneration),
                  plan.matches(policy: policy.schedule),
                  plan.binding.matches(policy.applicationTokens, logicalAppToken: policy.schedule.appToken) else {
                return DeviceActivityUsageMonitorStatus.unavailable
            }
            return plan.status(at: now, deviceTimeZone: deviceTimeZone())
        }) ?? .unavailable
    }

    /// Reuse only the currently installed accepted payloads. Renewal needs host
    /// execution; a recurring health monitor cannot renew this finite usage plan.
    /// The explicit binding provider and all registration checks run again.
    public func renewInstalledUsageMonitor(now: Date) throws -> PCAProtectionPolicyApplicationResult {
        try policyCoordination.withExclusiveAccess {
            guard let installation = currentInstallation(), installation.state == .active,
                  currentActiveActivityId() == installation.policyActivityId else {
                throw PCAProtectionPolicyApplicationError.malformedPolicy
            }
            let suffix = installation.payloadStorageGeneration.map { "." + $0 } ?? ""
            guard let schedule = blobStore.read(forKey: "schedule.\(installation.policyActivityId)\(suffix)"),
                  let tokens = blobStore.read(forKey: "applicationTokens.\(installation.policyActivityId)\(suffix)"),
                  let floor = blobStore.read(forKey: "protectedApplicationTokens\(suffix)"),
                  case .success(let policy) = PolicySyncDecoder.decode(schedule),
                  policy.activityId.utf8.elementsEqual(installation.policyActivityId.utf8) else {
                throw PCAProtectionPolicyApplicationError.malformedPolicy
            }
            return try applyPolicyUnderLock(scheduleData: schedule, applicationTokenData: tokens,
                protectedApplicationTokenData: floor, now: now)
        }
    }

    public func clearPolicy(activityId: String) {
        try? policyCoordination.withExclusiveAccess { clearPolicyUnderLock(activityId: activityId) }
    }

    private func clearPolicyUnderLock(activityId: String) {
        mutationLock.lock()
        defer { mutationLock.unlock() }
        let installation = currentInstallation()
        let activeActivityId = currentActiveActivityId()
        guard installation?.policyActivityId == activityId || activeActivityId == activityId else { return }
        blobStore.remove(forKey: deviceActivityMonitorInstallationStorageKey)
        blobStore.remove(forKey: "activeActivityId")
        guard blobStore.read(forKey: deviceActivityMonitorInstallationStorageKey) == nil,
              blobStore.read(forKey: "activeActivityId") == nil else { return }
        if let installation { retire(installation) }
        else {
            scheduler.stop(activityId: activityId)
            removePayloads(policyActivityId: activityId, generation: nil)
            for id in scheduler.ownedMonitorActivityIds() { scheduler.stop(activityId: id) }
        }
        shieldEnforcer.removeAll()
    }

    private func removePayloads(policyActivityId: String, generation: String?) {
        let suffix = generation.map { "." + $0 } ?? ""
        blobStore.remove(forKey: "schedule.\(policyActivityId)\(suffix)")
        blobStore.remove(forKey: "applicationTokens.\(policyActivityId)\(suffix)")
        blobStore.remove(forKey: "protectedApplicationTokens\(suffix)")
    }

    private func retire(_ installation: DeviceActivityMonitorInstallation) {
        for id in installation.allMonitorActivityIds { scheduler.stop(activityId: id) }
        removePayloads(policyActivityId: installation.policyActivityId, generation: installation.payloadStorageGeneration)
        DeviceActivityUsageLowerBoundStore<ApplicationToken>(store: blobStore).discardPending(generation: installation.generation)
    }

    private func invalidate(_ installation: DeviceActivityMonitorInstallation) {
        // Persist non-active evidence before deletion. A failed unlink must not
        // expose the previously published active generation to queued callbacks.
        try? writeInstallation(installation.invalidating())
        blobStore.remove(forKey: "activeActivityId")
        let pointerAbsent = blobStore.read(forKey: "activeActivityId") == nil
        let data = blobStore.read(forKey: deviceActivityMonitorInstallationStorageKey)
        let decoded = data.flatMap { DeviceActivityMonitorInstallation.decodeValidated($0) }
        let nonActive = data == nil || decoded?.state != .active
        if pointerAbsent && nonActive {
            blobStore.remove(forKey: deviceActivityMonitorInstallationStorageKey)
        }
        // Retain a verified invalidated tombstone if the pointer cannot be
        // removed. Active-only loading rejects it even when payload unlink fails.
        retire(installation)
    }

    public func callbackHealth(now: Date) -> DeviceActivityCallbackHealth {
        mutationLock.lock()
        defer { mutationLock.unlock() }
        guard let callbackLog = callbackLog,
              let installation = currentInstallation(),
              installation.state == .active,
              currentActiveActivityId() == installation.policyActivityId,
              let timeZone = TimeZone(identifier: installation.timeZoneIdentifier),
              let policyData = blobStore.read(forKey: "schedule.\(installation.policyActivityId)\(installation.payloadStorageGeneration.map { "." + $0 } ?? "")"),
              case .success(let policy) = PolicySyncDecoder.decode(policyData),
              policy.activityId == installation.policyActivityId else {
            return .unknown
        }

        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        let expected = DeviceActivityCallbackPlanner.expectedCallbacks(
            installedAt: installation.installedAtUtc,
            now: now,
            calendar: calendar
        )
        let observations = callbackLog.readAll()
            .filter {
                $0.activityId == installation.monitorActivityId &&
                $0.installationGeneration == installation.generation
            }
            .map(\.asObservedCallback)
        return DeviceActivityCallbackReconciler.reconcile(
            expected: expected,
            observed: observations,
            activityId: installation.monitorActivityId,
            installationGeneration: installation.generation,
            nowUtc: now
        )
    }

    private func currentInstallation() -> DeviceActivityMonitorInstallation? {
        guard let data = blobStore.read(forKey: deviceActivityMonitorInstallationStorageKey) else { return nil }
        return DeviceActivityMonitorInstallation.decodeValidated(data)
    }

    private func currentActiveActivityId() -> String? {
        guard let data = blobStore.read(forKey: "activeActivityId"),
              let value = String(data: data, encoding: .utf8),
              !value.isEmpty else { return nil }
        return value
    }

    private func writeInstallation(_ installation: DeviceActivityMonitorInstallation) throws {
        let data = try installationEncoder.encode(installation)
        try blobStore.write(data, forKey: deviceActivityMonitorInstallationStorageKey)
        guard blobStore.read(forKey: deviceActivityMonitorInstallationStorageKey) == data else {
            throw PCAProtectionPolicyApplicationError.persistenceFailed
        }
    }

    public static func production(
        authorizationIsApproved: @escaping () -> Bool,
        appGroupIdentifier: String,
        usageBindingProvider: @escaping (DecodedSchedulePolicy, Set<ApplicationToken>) -> DeviceActivityUsageSelectionBinding? = { _, _ in nil }
    ) throws -> PCAProductionProtectionPolicyRuntime {
        let blobStore = try AppGroupDeviceActivityFileStore(appGroupIdentifier: appGroupIdentifier)
        let coordination = try AppGroupDeviceActivityPolicyCoordination(appGroupIdentifier: appGroupIdentifier)
        let callbackLog = try? AppGroupCallbackObservationLog(appGroupIdentifier: appGroupIdentifier, installationReader: { blobStore.read(forKey: deviceActivityMonitorInstallationStorageKey) })
        return PCAProductionProtectionPolicyRuntime(
            authorizationIsApproved: authorizationIsApproved,
            blobStore: blobStore,
            callbackLog: callbackLog,
            policyCoordination: coordination,
            usageBindingProvider: usageBindingProvider
        )
    }
}
#endif
