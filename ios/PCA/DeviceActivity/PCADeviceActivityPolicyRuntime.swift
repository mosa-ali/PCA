import Foundation
#if canImport(DeviceActivity) && canImport(FamilyControls) && canImport(ManagedSettings)
import DeviceActivity
import FamilyControls
import ManagedSettings

/// Synchronous binding lookup called while the runtime holds policy
/// coordination. Store-backed resolvers must use the supplied access token.
public typealias PCADeviceActivityUsageBindingProvider =
    (DecodedSchedulePolicy, Set<ApplicationToken>, DeviceActivityPolicyLockAccess) -> DeviceActivityUsageSelectionBinding?

/// The factory receives the exact runtime store and coordinator. Keep usage
/// binding unavailable by leaving this nil until trusted authority is composed.
public typealias PCADeviceActivityUsageBindingProviderFactory =
    (AppGroupDeviceActivityFileStore, DeviceActivityPolicyCoordination) -> PCADeviceActivityUsageBindingProvider
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
    private let usageBindingProvider: PCADeviceActivityUsageBindingProvider
    private let deviceTimeZone: () -> TimeZone
    private let shieldEnforcer: PCADeviceActivityShieldEnforcing

    public init(
        authorizationIsApproved: @escaping () -> Bool,
        scheduler: PCADeviceActivityScheduler = SystemPCADeviceActivityScheduler(),
        blobStore: OpaqueBlobStore,
        callbackLog: CallbackObservationLog? = nil,
        installationClock: @escaping () -> Date = Date.init,
        policyCoordination: DeviceActivityPolicyCoordination = LocalDeviceActivityPolicyCoordination(),
        usageBindingProvider: @escaping PCADeviceActivityUsageBindingProvider = { _, _, _ in nil },
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
        // The active installation manifest is the commit record. If process
        // death occurs after its write but before the compatibility pointer,
        // repair that pointer from the manifest. Also reclaim any new monitor
        // names left by a process death during staging; a monitor absent from
        // the committed manifest cannot apply policy.
        try? policyCoordination.withExclusiveAccess {
            if let installation = currentInstallation(), installation.state == .active {
                let activeId = Data(installation.policyActivityId.utf8)
                if blobStore.read(forKey: "activeActivityId") != activeId {
                    try? blobStore.write(activeId, forKey: "activeActivityId")
                }
                let committed = Set(installation.allMonitorActivityIds)
                // Free slots held by uncommitted staging IDs before restoring
                // missing committed IDs. This ordering matters at the 20-slot
                // system limit after process death during a full-cap swap.
                for id in scheduler.ownedMonitorActivityIds() where !committed.contains(id) {
                    scheduler.stop(activityId: id)
                }
                if authorizationIsApproved() { try? restoreMissingMonitors(for: installation) }
            } else {
                if let incomplete = currentInstallation() { invalidate(incomplete) }
                for id in scheduler.ownedMonitorActivityIds() { scheduler.stop(activityId: id) }
            }
        }
    }

    public func applyVerifiedPolicy(
        scheduleData: Data,
        applicationTokenData: Data,
        protectedApplicationTokenData: Data?,
        now: Date
    ) throws -> PCAProtectionPolicyApplicationResult {
        do {
            return try policyCoordination.withExclusiveAccessContext { access in
                try applyPolicyUnderLock(scheduleData: scheduleData, applicationTokenData: applicationTokenData,
                    protectedApplicationTokenData: protectedApplicationTokenData, now: now, lockAccess: access)
            }
        } catch let error as PCAProtectionPolicyApplicationError { throw error }
        catch { throw PCAProtectionPolicyApplicationError.persistenceFailed }
    }

    private func applyPolicyUnderLock(scheduleData: Data, applicationTokenData: Data,
                                      protectedApplicationTokenData: Data?, now: Date,
                                      lockAccess: DeviceActivityPolicyLockAccess) throws -> PCAProtectionPolicyApplicationResult {
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
        if policy.dailyLimit != nil, let binding = usageBindingProvider(policy, applicationTokens, lockAccess),
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
        let previousInstallationData = blobStore.read(forKey: deviceActivityMonitorInstallationStorageKey)
        let previousInstallation = previousInstallationData.flatMap {
            DeviceActivityMonitorInstallation.decodeValidated($0)
        }
        // Consult the legacy pointer only when the manifest key is absent.
        // A malformed present manifest must not downgrade authority.
        let previousActiveId = previousInstallationData == nil ? currentActiveActivityId() : nil
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
        let previousActiveData = blobStore.read(forKey: "activeActivityId")

        // Keep the published generation and its monitors intact while the
        // replacement is staged. Reclaim only orphaned generated OS names;
        // the current installation or legacy pointer retains its monitors.
        let retainedMonitorIds = Set(previousInstallation?.allMonitorActivityIds ?? [])
        for id in scheduler.ownedMonitorActivityIds()
            where !retainedMonitorIds.contains(id) && id != previousActiveId {
            scheduler.stop(activityId: id)
        }
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
        let previousMonitorIds = Set(previousInstallation?.allMonitorActivityIds ??
            (previousActiveId.map { [$0] } ?? []))
        let replacementNeedsCapacityHandoff = previousMonitorIds.count + installation.allMonitorActivityIds.count >
            DeviceActivityScheduleMapper.maximumMonitoredActivities
        if replacementNeedsCapacityHandoff {
            // Keep the previous manifest/payload as the recovery record, but
            // free OS activity slots before registering distinct new IDs.
            for id in previousMonitorIds { scheduler.stop(activityId: id) }
        }
        do {
            try scheduler.start(activityId: installation.monitorActivityId, calendar: monitoringCalendar)
            for boundary in boundaries {
                try scheduler.startBoundary(activityId: boundary.activityId, trigger: boundary.trigger)
            }
            if let usagePlan { try scheduler.startUsage(plan: usagePlan, applications: applicationTokens) }
        } catch {
            // Stop every staged name, including a throwing registration that
            // may have partially reached the OS. Preserve the previously
            // published generation for callbacks and relaunch.
            for id in installation.allMonitorActivityIds { scheduler.stop(activityId: id) }
            removePayloads(policyActivityId: policy.activityId, generation: generation)
            if replacementNeedsCapacityHandoff {
                restorePreviousMonitors(installation: previousInstallation, legacyActivityId: previousActiveId)
            }
            throw PCAProtectionPolicyApplicationError.schedulingFailed
        }
        do {
            // The active manifest is the commit point. The pointer is only a
            // compatibility mirror, so its repair/write failure must not roll
            // back an otherwise durable policy generation.
            try writeInstallation(installation.confirmingActive())
            try? blobStore.write(Data(policy.activityId.utf8), forKey: "activeActivityId")
            guard currentInstallation() == installation.confirmingActive() else {
                throw PCAProtectionPolicyApplicationError.persistenceFailed
            }
        } catch {
            // Restore the exact prior manifest if the manifest publication or
            // readback failed. The compatibility pointer is best-effort and
            // cannot decide whether this generation committed.
            let restored = restorePublication(installationData: previousInstallationData,
                activeData: previousActiveData)
            for id in installation.allMonitorActivityIds { scheduler.stop(activityId: id) }
            removePayloads(policyActivityId: policy.activityId, generation: generation)
            if !restored,
               blobStore.read(forKey: deviceActivityMonitorInstallationStorageKey) != previousInstallationData {
                invalidate(installation)
            }
            if restored && replacementNeedsCapacityHandoff {
                restorePreviousMonitors(installation: previousInstallation, legacyActivityId: previousActiveId)
            }
            throw PCAProtectionPolicyApplicationError.persistenceFailed
        }

        // The new policy is now durably active. Retire the former generation
        // only after successful publication so a failed replacement keeps
        // enforcing its last accepted policy.
        if let previousInstallation {
            retire(previousInstallation)
        } else if let previousActiveId {
            if !installation.allMonitorActivityIds.contains(previousActiveId) {
                scheduler.stop(activityId: previousActiveId)
            }
            removePayloads(policyActivityId: previousActiveId, generation: nil)
        }
        for id in scheduler.ownedMonitorActivityIds()
            where !installation.allMonitorActivityIds.contains(id) {
            scheduler.stop(activityId: id)
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
        try policyCoordination.withExclusiveAccessContext { access in
            guard let installation = currentInstallation(), installation.state == .active else {
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
                protectedApplicationTokenData: floor, now: now, lockAccess: access)
        }
    }

    public func clearPolicy(activityId: String) {
        try? policyCoordination.withExclusiveAccess { clearPolicyUnderLock(activityId: activityId) }
    }

    private func clearPolicyUnderLock(activityId: String) {
        mutationLock.lock()
        defer { mutationLock.unlock() }
        let installationData = blobStore.read(forKey: deviceActivityMonitorInstallationStorageKey)
        let installation = installationData.flatMap { DeviceActivityMonitorInstallation.decodeValidated($0) }
        let activeActivityId = currentActiveActivityId()
        // A validated manifest is authoritative. The legacy pointer is only a
        // fallback when no manifest exists; it may be stale if its best-effort
        // repair failed after a process interruption.
        guard installation?.policyActivityId == activityId ||
            (installationData == nil && activeActivityId == activityId) else { return }
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

    private func restoreMissingMonitors(for installation: DeviceActivityMonitorInstallation) throws {
        guard installation.state == .active,
              let manifestData = blobStore.read(forKey: deviceActivityMonitorInstallationStorageKey),
              DeviceActivityMonitorInstallation.decodeValidated(manifestData) == installation,
              let snapshot = StoredDeviceActivityPolicyLoader<ApplicationToken>(scheduleStore: blobStore, tokenStore: blobStore)
                .load(activityId: installation.policyActivityId, storageGeneration: installation.payloadStorageGeneration),
              let zone = TimeZone(identifier: installation.timeZoneIdentifier) else {
            throw PCAProtectionPolicyApplicationError.malformedPolicy
        }
        let activeIds = Set(scheduler.ownedMonitorActivityIds())
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = zone
        var started: [String] = []
        do {
            if !activeIds.contains(installation.monitorActivityId) {
                // Include the attempted name before calling the scheduler:
                // an OS registration can take effect before reporting error.
                started.append(installation.monitorActivityId)
                try scheduler.start(activityId: installation.monitorActivityId, calendar: calendar)
            }
            for boundary in installation.boundaryMonitors ?? [] where !activeIds.contains(boundary.activityId) {
                started.append(boundary.activityId)
                try scheduler.startBoundary(activityId: boundary.activityId, trigger: boundary.trigger)
            }
            if let plan = installation.usageDayPlan, !activeIds.contains(plan.monitorActivityId) {
                started.append(plan.monitorActivityId)
                try scheduler.startUsage(plan: plan, applications: snapshot.applicationTokens)
            }
            guard blobStore.read(forKey: deviceActivityMonitorInstallationStorageKey) == manifestData else {
                throw PCAProtectionPolicyApplicationError.persistenceFailed
            }
        } catch {
            for id in started { scheduler.stop(activityId: id) }
            throw error
        }
    }

    private func restorePreviousMonitors(installation: DeviceActivityMonitorInstallation?, legacyActivityId: String?) {
        do {
            if let installation {
                try restoreMissingMonitors(for: installation)
            } else if let legacyActivityId,
                      !scheduler.ownedMonitorActivityIds().contains(legacyActivityId),
                      StoredDeviceActivityPolicyLoader<ApplicationToken>(scheduleStore: blobStore, tokenStore: blobStore)
                        .load(activityId: legacyActivityId) != nil {
                try scheduler.start(activityId: legacyActivityId, calendar: DeviceActivityScheduleMapper.monitoringCalendar())
            }
        } catch {
            // The durable old manifest/payload remains authoritative. A later
            // host relaunch retries missing registrations; no shield is cleared.
        }
    }

    private func writeInstallation(_ installation: DeviceActivityMonitorInstallation) throws {
        let data = try installationEncoder.encode(installation)
        try blobStore.write(data, forKey: deviceActivityMonitorInstallationStorageKey)
        guard blobStore.read(forKey: deviceActivityMonitorInstallationStorageKey) == data else {
            throw PCAProtectionPolicyApplicationError.persistenceFailed
        }
    }

    private func restorePublication(installationData: Data?, activeData: Data?) -> Bool {
        do {
            if let installationData {
                try blobStore.write(installationData, forKey: deviceActivityMonitorInstallationStorageKey)
            } else {
                blobStore.remove(forKey: deviceActivityMonitorInstallationStorageKey)
            }
            guard blobStore.read(forKey: deviceActivityMonitorInstallationStorageKey) == installationData else {
                return false
            }
        } catch {
            return false
        }
        // Restoring the prior commit point is sufficient. The old pointer is
        // repaired best-effort and cannot invalidate a valid old manifest.
        if let activeData { try? blobStore.write(activeData, forKey: "activeActivityId") }
        else { blobStore.remove(forKey: "activeActivityId") }
        return true
    }

    public static func production(
        authorizationIsApproved: @escaping () -> Bool,
        appGroupIdentifier: String,
        usageBindingProviderFactory: PCADeviceActivityUsageBindingProviderFactory? = nil
    ) throws -> PCAProductionProtectionPolicyRuntime {
        let blobStore = try AppGroupDeviceActivityFileStore(appGroupIdentifier: appGroupIdentifier)
        let coordination = try AppGroupDeviceActivityPolicyCoordination(appGroupIdentifier: appGroupIdentifier)
        let usageBindingProvider = usageBindingProviderFactory?(blobStore, coordination) ?? { _, _, _ in nil }
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
