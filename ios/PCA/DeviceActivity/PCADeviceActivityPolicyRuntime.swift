import Foundation

let deviceActivityPolicyRetirementIntentStorageKey = "com.pca.app.deviceactivity.retirement-intent.v1"
let deviceActivityPolicyClearIntentStorageKey = "com.pca.app.deviceactivity.clear-intent.v1"

struct DeviceActivityPolicyRetirementIntent: Codable, Equatable {
    let previousInstallation: DeviceActivityMonitorInstallation
}

struct DeviceActivityPolicyClearIntent: Codable, Equatable {
    let policyActivityId: String
    let installation: DeviceActivityMonitorInstallation?
}

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
    /// Reconcile the exact committed policy after app foreground/background
    /// lifecycle transitions. Nil means there is no active installation.
    func reconcileInstalledPolicy(now: Date) throws -> PCAProtectionPolicyApplicationResult?
}

public extension PCAProtectionPolicyRuntime {
    func usageMonitorStatus(now: Date) -> DeviceActivityUsageMonitorStatus { .unavailable }
    func renewInstalledUsageMonitor(now: Date) throws -> PCAProtectionPolicyApplicationResult {
        throw PCAProtectionPolicyApplicationError.frameworkUnavailable
    }
    func reconcileInstalledPolicy(now: Date) throws -> PCAProtectionPolicyApplicationResult? { nil }
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
    /// Keep every payload decoded into App Group state within the same bound
    /// used for a complete stored policy document. Opaque FamilyControls
    /// token blobs are otherwise unbounded before PropertyListDecoder runs.
    private static let maximumPolicyInputBytes = 1_048_576
    private let authorizationIsApproved: () -> Bool
    private let scheduler: PCADeviceActivityScheduler
    private let blobStore: OpaqueBlobStore
    private let callbackLog: CallbackObservationLog?
    private let plistDecoder = PropertyListDecoder()
    private let installationEncoder = JSONEncoder()
    private let installationClock: () -> Date
    private let mutationLock = NSRecursiveLock()
    private let policyCoordination: DeviceActivityPolicyCoordination
    private let trustedTimeFloor: DeviceActivityTrustedTimeFloor
    private let usageBindingProvider: PCADeviceActivityUsageBindingProvider
    private let deviceTimeZone: () -> TimeZone
    private let shieldEnforcer: PCADeviceActivityShieldEnforcing
    private let pendingUsageActivator: (DeviceActivityUsageDayPlan) throws -> Void
    private var startupMonitorFailureGeneration: String?
    private var startupUsageFailureGeneration: String?
    private var startupEnforcementFailureGeneration: String?
    private var startupRecoveryDeferred = false

    public convenience init(
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
        self.init(authorizationIsApproved: authorizationIsApproved,
            scheduler: scheduler, blobStore: blobStore, callbackLog: callbackLog,
            installationClock: installationClock, policyCoordination: policyCoordination,
            usageBindingProvider: usageBindingProvider, deviceTimeZone: deviceTimeZone,
            shieldEnforcer: shieldEnforcer, pendingUsageActivator: { plan in
                try DeviceActivityUsageLowerBoundStore<ApplicationToken>(store: blobStore).activate(plan: plan)
            })
    }

    // Internal injection keeps recovery deterministic in unit tests while
    // the public production initializer always binds activation to the real
    // FamilyControls ApplicationToken store.
    init(
        authorizationIsApproved: @escaping () -> Bool,
        scheduler: PCADeviceActivityScheduler,
        blobStore: OpaqueBlobStore,
        callbackLog: CallbackObservationLog? = nil,
        installationClock: @escaping () -> Date = Date.init,
        policyCoordination: DeviceActivityPolicyCoordination = LocalDeviceActivityPolicyCoordination(),
        usageBindingProvider: @escaping PCADeviceActivityUsageBindingProvider = { _, _, _ in nil },
        deviceTimeZone: @escaping () -> TimeZone = { .current },
        shieldEnforcer: PCADeviceActivityShieldEnforcing = SystemPCADeviceActivityShieldEnforcer(),
        pendingUsageActivator: @escaping (DeviceActivityUsageDayPlan) throws -> Void
    ) {
        self.authorizationIsApproved = authorizationIsApproved
        self.scheduler = scheduler
        self.blobStore = blobStore
        self.callbackLog = callbackLog
        self.installationClock = installationClock
        self.policyCoordination = policyCoordination
        self.trustedTimeFloor = DeviceActivityTrustedTimeFloor(store: blobStore, coordination: policyCoordination)
        self.usageBindingProvider = usageBindingProvider
        self.deviceTimeZone = deviceTimeZone
        self.shieldEnforcer = shieldEnforcer
        self.pendingUsageActivator = pendingUsageActivator
        // The active installation manifest is the commit record. If process
        // death occurs after its write but before the compatibility pointer,
        // repair that pointer from the manifest. Also reclaim any new monitor
        // names left by a process death during staging; a monitor absent from
        // the committed manifest cannot apply policy.
        do {
            try policyCoordination.withExclusiveAccessContext { access in
                try reconcileClearIntent()
                reconcileRetirementIntent()
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
                    guard authorizationIsApproved() else {
                        // A persisted active policy is not authority to leave
                        // stale ManagedSettings restrictions in place after
                        // FamilyControls approval is lost. Clear only the
                        // current enforcement state; preserve the committed
                        // manifest and payload so approval restoration can
                        // reconcile this exact generation later.
                        shieldEnforcer.removeAll()
                        markStartupRecoveryRequired(for: installation)
                        return
                    }
                    let trustedNow = try trustedTimeFloor.observe(installationClock(), access: access)
                    recoverStartupState(for: installation, now: trustedNow)
                } else {
                    if let incomplete = currentInstallation() {
                        if incomplete.state == .invalidated {
                            try persistClearIntent(DeviceActivityPolicyClearIntent(
                                policyActivityId: incomplete.policyActivityId, installation: incomplete))
                            try reconcileClearIntent()
                        } else {
                            invalidate(incomplete)
                        }
                    }
                    for id in scheduler.ownedMonitorActivityIds() { scheduler.stop(activityId: id) }
                }
            }
        } catch {
            // Startup must be retryable after a transient cross-process lock
            // failure. callbackHealth resolves the committed generation under
            // that same lock before it can report healthy callback evidence.
            startupRecoveryDeferred = true
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
        // Clear recovery takes mutationLock itself. Resolve it while the
        // cross-process policy lock is held, but before entering the local
        // mutation critical section.
        try reconcileClearIntent()
        mutationLock.lock()
        defer { mutationLock.unlock() }
        reconcileRetirementIntent()
        guard authorizationIsApproved() else {
            if let installation = currentInstallation(), installation.state == .active {
                markStartupRecoveryRequired(for: installation)
            }
            // Authorization can be revoked after startup while the prior
            // ManagedSettings state is still present. Match the callback and
            // startup gates: clear this app's current shields, but retain the
            // committed generation for exact recovery after approval returns.
            shieldEnforcer.removeAll()
            throw PCAProtectionPolicyApplicationError.authorizationRequired
        }
        let trustedNow = try trustedTimeFloor.observe(now, access: lockAccess)
        guard case .success(let policy) = PolicySyncDecoder.decode(scheduleData) else {
            throw PCAProtectionPolicyApplicationError.malformedPolicy
        }
        guard applicationTokenData.count <= Self.maximumPolicyInputBytes,
              protectedApplicationTokenData.map({ $0.count <= Self.maximumPolicyInputBytes }) ?? true else {
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

        // The caller supplies a wall-clock candidate; the durable local
        // high-water mark prevents a rollback from reviving an expired rule.
        // installationClock remains only the OS-generation install timestamp.
        let planningTime = trustedNow
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
        guard previousInstallationData == nil || previousInstallation != nil else {
            // A present but corrupt commit record may belong to a policy that
            // was active before storage damage. Do not treat it as a fresh
            // install, register callback-capable monitors, or overwrite the
            // only remaining evidence with a new generation.
            throw PCAProtectionPolicyApplicationError.persistenceFailed
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
        // Before the first installation has a previously committed policy,
        // publish a non-active manifest before any callback-capable monitor
        // starts. Usage threshold callbacks can then persist as pending
        // observations and are merged only after the active manifest commits.
        // During replacement the old active manifest remains authoritative;
        // this single-manifest protocol does not overwrite it with staging.
        let publishStartingManifest = previousInstallationData == nil && previousActiveId == nil
        if publishStartingManifest {
            do { try writeInstallation(installation) }
            catch {
                if currentInstallation() == installation { invalidate(installation) }
                else { removePayloads(policyActivityId: policy.activityId, generation: generation) }
                throw PCAProtectionPolicyApplicationError.persistenceFailed
            }
        }
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
            if publishStartingManifest {
                invalidate(installation)
            } else {
                for id in installation.allMonitorActivityIds { scheduler.stop(activityId: id) }
                removePayloads(policyActivityId: policy.activityId, generation: generation)
                if let usagePlan { DeviceActivityUsageLowerBoundStore<ApplicationToken>(store: blobStore).discardPending(generation: usagePlan.generation) }
            }
            if replacementNeedsCapacityHandoff {
                restorePreviousMonitors(installation: previousInstallation, legacyActivityId: previousActiveId)
            }
            throw PCAProtectionPolicyApplicationError.schedulingFailed
        }
        do {
            // The active manifest is the commit point. The pointer is only a
            // compatibility mirror, so its repair/write failure must not roll
            // back an otherwise durable policy generation.
            if let previousInstallation, previousInstallation.state == .active {
                try writeRetirementIntent(for: previousInstallation)
            }
            try writeInstallation(installation.confirmingActive())
            try? blobStore.write(Data(policy.activityId.utf8), forKey: "activeActivityId")
            guard currentInstallation() == installation.confirmingActive() else {
                throw PCAProtectionPolicyApplicationError.persistenceFailed
            }
            // Once published, this generation needs local enforcement until
            // reconciliation succeeds. Keep a retry marker across any later
            // failure in this post-commit path.
            startupEnforcementFailureGeneration = installation.generation
        } catch {
            // Restore the exact prior manifest if the manifest publication or
            // readback failed. The compatibility pointer is best-effort and
            // cannot decide whether this generation committed.
            let restored = restorePublication(installationData: previousInstallationData,
                activeData: previousActiveData)
            for id in installation.allMonitorActivityIds { scheduler.stop(activityId: id) }
            removePayloads(policyActivityId: policy.activityId, generation: generation)
            if restored, let previousInstallation {
                clearRetirementIntent(ifMatching: previousInstallation)
            }
            if !restored,
               blobStore.read(forKey: deviceActivityMonitorInstallationStorageKey) != previousInstallationData {
                invalidate(installation)
            }
            if let usagePlan { DeviceActivityUsageLowerBoundStore<ApplicationToken>(store: blobStore).discardPending(generation: usagePlan.generation) }
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
            clearRetirementIntent(ifMatching: previousInstallation)
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

        // Authorization can change while DeviceActivity registrations are in
        // flight. Recheck at the final ManagedSettings boundary so a policy
        // staged under a previously approved state cannot reapply shields
        // after FamilyControls approval has been revoked. Keep the committed
        // generation for exact recovery, but stop its monitors and clear any
        // restrictions until approval returns.
        try requireEnforcementAuthorization(for: installation.confirmingActive())

        let evaluationTime = trustedNow
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
        let reconciled: Bool
        var usageActivationFailed = false
        do {
            reconciled = try DeviceActivityUsageEnforcement.reconcile(policy: policy, now: evaluationTime,
                applications: applicationTokens, protectedApplications: protectedTokens,
                deviceTimeZone: deviceTimeZone(), coverageAvailable: usageAvailable, loadLowerBound: {
                    guard let observationPlan else { return nil }
                    let usageStore = DeviceActivityUsageLowerBoundStore<ApplicationToken>(store: self.blobStore)
                    if let usagePlan {
                        do { try usageStore.activate(plan: usagePlan) }
                        catch { usageActivationFailed = true; throw error }
                    }
                    return try usageStore.lowerBound(for: observationPlan)
                },
                apply: {
                    // Authorization may change after registration and policy
                    // evaluation. Recheck at the actual ManagedSettings
                    // mutation boundary before applying.
                    try self.requireEnforcementAuthorization(for: installation.confirmingActive())
                    try self.shieldEnforcer.apply(applications: $0, protectedApplications: protectedTokens)
                },
                remove: { self.shieldEnforcer.removeAll() })
        } catch {
            if usageActivationFailed { startupUsageFailureGeneration = installation.generation }
            startupEnforcementFailureGeneration = installation.generation
            throw error
        }
        guard reconciled,
              currentInstallation() == installation.confirmingActive() else {
            startupEnforcementFailureGeneration = installation.generation
            return .degraded
        }
        startupMonitorFailureGeneration = nil
        startupUsageFailureGeneration = nil
        if startupEnforcementFailureGeneration == installation.generation {
            startupEnforcementFailureGeneration = nil
        }

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
        return (try? policyCoordination.withExclusiveAccessContext { access in
            let trustedNow = try trustedTimeFloor.observe(now, access: access)
            try reconcileClearIntent()
            guard let installation = currentInstallation(), installation.state == .active,
                  let plan = installation.usageDayPlan,
                  let policy = StoredDeviceActivityPolicyLoader<ApplicationToken>(scheduleStore: blobStore, tokenStore: blobStore)
                    .load(activityId: installation.policyActivityId, storageGeneration: installation.payloadStorageGeneration),
                  plan.matches(policy: policy.schedule),
                  plan.binding.matches(policy.applicationTokens, logicalAppToken: policy.schedule.appToken) else {
                return DeviceActivityUsageMonitorStatus.unavailable
            }
            return plan.status(at: trustedNow, deviceTimeZone: deviceTimeZone())
        }) ?? .unavailable
    }

    /// Reuse only the currently installed accepted payloads. Renewal needs host
    /// execution; a recurring health monitor cannot renew this finite usage plan.
    /// The explicit binding provider and all registration checks run again.
    public func renewInstalledUsageMonitor(now: Date) throws -> PCAProtectionPolicyApplicationResult {
        try policyCoordination.withExclusiveAccessContext { access in
            try reconcileClearIntent()
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

    /// Reapply the exact locally committed policy without advancing its
    /// generation. DeviceActivity callbacks normally drive policy edges while
    /// the host is suspended, but a foreground/background wake can follow a
    /// missed callback or an OS-cleared ManagedSettings state. The durable
    /// active manifest remains the only input; this method cannot accept or
    /// create policy authority.
    public func reconcileInstalledPolicy(now: Date) throws -> PCAProtectionPolicyApplicationResult? {
        do {
            return try policyCoordination.withExclusiveAccessContext { access in
                let trustedNow = try trustedTimeFloor.observe(now, access: access)
                try reconcileClearIntent()
                mutationLock.lock()
                defer { mutationLock.unlock() }
                reconcileRetirementIntent()
                guard let installation = currentInstallation(), installation.state == .active else { return nil }
                do {
                    try requireEnforcementAuthorization(for: installation)
                    try restoreMissingMonitors(for: installation)
                    if let usagePlan = installation.usageDayPlan { try pendingUsageActivator(usagePlan) }
                    try restoreCommittedEnforcement(for: installation, now: trustedNow)
                    startupRecoveryDeferred = false
                    startupMonitorFailureGeneration = nil
                    startupUsageFailureGeneration = nil
                    startupEnforcementFailureGeneration = nil

                    guard let snapshot = StoredDeviceActivityPolicyLoader<ApplicationToken>(
                        scheduleStore: blobStore, tokenStore: blobStore
                    ).load(activityId: installation.policyActivityId,
                           storageGeneration: installation.payloadStorageGeneration) else {
                        throw PCAProtectionPolicyApplicationError.malformedPolicy
                    }
                    if snapshot.schedule.dailyLimit != nil {
                        guard let plan = installation.usageDayPlan,
                              plan.binding.matches(snapshot.applicationTokens, logicalAppToken: snapshot.schedule.appToken),
                              plan.policyTimeZoneIdentifier.utf8.elementsEqual(snapshot.schedule.timeZone.identifier.utf8),
                              plan.coverage == .wholePolicyDayPlanned,
                              plan.contains(trustedNow, deviceTimeZone: deviceTimeZone()) else { return .degraded }
                    }
                    switch snapshot.schedule.enforcementCapability {
                    case .enforced: return .applied
                    case .degraded, .unavailable: return .degraded
                    }
                } catch {
                    markStartupRecoveryRequired(for: installation)
                    throw error
                }
            }
        } catch let error as PCAProtectionPolicyApplicationError {
            throw error
        } catch {
            throw PCAProtectionPolicyApplicationError.persistenceFailed
        }
    }

    public func clearPolicy(activityId: String) {
        try? policyCoordination.withExclusiveAccess {
            try reconcileClearIntent()
            reconcileRetirementIntent()
            try clearPolicyUnderLock(activityId: activityId)
        }
    }

    private func clearPolicyUnderLock(activityId: String) throws {
        try reconcileClearIntent()
        let shouldReconcile = try {
            mutationLock.lock()
            defer { mutationLock.unlock() }
            let installationData = blobStore.read(forKey: deviceActivityMonitorInstallationStorageKey)
            let installation = installationData.flatMap { DeviceActivityMonitorInstallation.decodeValidated($0) }
            let activeActivityId = currentActiveActivityId()
            // A validated manifest is authoritative. The legacy pointer is only a
            // fallback when no manifest exists; it may be stale if its best-effort
            // repair failed after a process interruption.
            guard installation?.policyActivityId == activityId ||
                (installationData == nil && activeActivityId == activityId) else { return false }
            let clearingInstallation = installation ?? DeviceActivityMonitorInstallation(
                policyActivityId: activityId,
                monitorActivityId: "pca-monitor-\(UUID().uuidString.lowercased())",
                generation: UUID().uuidString.lowercased(), installedAtUtc: installationClock(),
                timeZoneIdentifier: DeviceActivityScheduleMapper.monitoringCalendar().timeZone.identifier,
                state: .invalidated)
            let tombstone = clearingInstallation.invalidating()
            try writeInstallation(tombstone)
            let intent = DeviceActivityPolicyClearIntent(policyActivityId: activityId, installation: tombstone)
            try persistClearIntent(intent)
            return true
        }()
        // Keep policyCoordination held by the caller throughout this method,
        // while letting reconciliation acquire mutationLock in its own scope.
        guard shouldReconcile else { return }
        try reconcileClearIntent()
    }

    private func persistClearIntent(_ intent: DeviceActivityPolicyClearIntent) throws {
        let data = try encodeClearIntent(intent)
        try blobStore.write(data, forKey: deviceActivityPolicyClearIntentStorageKey)
        guard blobStore.read(forKey: deviceActivityPolicyClearIntentStorageKey) == data else {
            throw PCAProtectionPolicyApplicationError.persistenceFailed
        }
    }

    private func encodeClearIntent(_ intent: DeviceActivityPolicyClearIntent) throws -> Data {
        guard Self.isValidClearIntent(intent) else { throw PCAProtectionPolicyApplicationError.persistenceFailed }
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]
        let data = try encoder.encode(intent)
        guard data.count <= 262_144 else { throw PCAProtectionPolicyApplicationError.persistenceFailed }
        return data
    }

    /// Completes an interrupted policy clear before any policy restore or
    /// enforcement operation can observe the old installation as active.
    /// The durable intent stays until monitor, manifest, payload, pointer and
    /// ManagedSettings cleanup have all been attempted and the commit keys
    /// read back absent.
    private func reconcileClearIntent() throws {
        guard let data = blobStore.read(forKey: deviceActivityPolicyClearIntentStorageKey) else {
            if let manifestData = blobStore.read(forKey: deviceActivityMonitorInstallationStorageKey),
               let installation = DeviceActivityMonitorInstallation.decodeValidated(manifestData),
               installation.state == .invalidated {
                try persistClearIntent(DeviceActivityPolicyClearIntent(
                    policyActivityId: installation.policyActivityId, installation: installation))
                try reconcileClearIntent()
            }
            return
        }
        guard data.count <= 262_144,
              (try? StrictJSONDocument.validateNoDuplicateMembers(data, maximumBytes: 262_144)) != nil,
              let intent = try? JSONDecoder().decode(DeviceActivityPolicyClearIntent.self, from: data),
              Self.isValidClearIntent(intent) else {
            throw PCAProtectionPolicyApplicationError.persistenceFailed
        }

        let manifestData = blobStore.read(forKey: deviceActivityMonitorInstallationStorageKey)
        if let manifestData, let current = DeviceActivityMonitorInstallation.decodeValidated(manifestData),
           intent.installation != current {
            // A newer committed policy superseded this clear request. Never
            // let a stale marker erase its settings; normal writers reconcile
            // this marker before publishing a new generation.
            blobStore.remove(forKey: deviceActivityPolicyClearIntentStorageKey)
            guard blobStore.read(forKey: deviceActivityPolicyClearIntentStorageKey) == nil else {
                throw PCAProtectionPolicyApplicationError.persistenceFailed
            }
            return
        }

        mutationLock.lock()
        defer { mutationLock.unlock() }
        shieldEnforcer.removeAll()
        if let installation = intent.installation {
            for id in installation.allMonitorActivityIds { scheduler.stop(activityId: id) }
            if installation.payloadStorageGeneration == nil {
                scheduler.stop(activityId: intent.policyActivityId)
                for id in scheduler.ownedMonitorActivityIds() { scheduler.stop(activityId: id) }
            }
            if let manifestData,
               DeviceActivityMonitorInstallation.decodeValidated(manifestData) == installation {
                blobStore.remove(forKey: deviceActivityMonitorInstallationStorageKey)
            } else if let manifestData,
                      DeviceActivityMonitorInstallation.decodeValidated(manifestData) == nil {
                // The durable clear intent was created from this validated
                // generation before interruption; a now-corrupt manifest
                // cannot become an active fallback after cleanup.
                blobStore.remove(forKey: deviceActivityMonitorInstallationStorageKey)
            }
            if blobStore.read(forKey: "activeActivityId") != nil {
                blobStore.remove(forKey: "activeActivityId")
            }
            retire(installation)
        } else {
            for id in scheduler.ownedMonitorActivityIds() { scheduler.stop(activityId: id) }
            if blobStore.read(forKey: "activeActivityId") != nil {
                blobStore.remove(forKey: "activeActivityId")
            }
            removePayloads(policyActivityId: intent.policyActivityId, generation: nil)
        }

        let remainingManifest = blobStore.read(forKey: deviceActivityMonitorInstallationStorageKey)
        let remainingInstallation = remainingManifest.flatMap {
            DeviceActivityMonitorInstallation.decodeValidated($0)
        }
        guard remainingManifest == nil || remainingInstallation?.policyActivityId != intent.policyActivityId,
              blobStore.read(forKey: "activeActivityId") == nil else {
            throw PCAProtectionPolicyApplicationError.persistenceFailed
        }
        let suffix = intent.installation?.payloadStorageGeneration.map { "." + $0 } ?? ""
        let payloadKeys = [
            "schedule.\(intent.policyActivityId)\(suffix)",
            "applicationTokens.\(intent.policyActivityId)\(suffix)",
            "protectedApplicationTokens\(suffix)",
        ]
        guard payloadKeys.allSatisfy({ blobStore.read(forKey: $0) == nil }) else {
            throw PCAProtectionPolicyApplicationError.persistenceFailed
        }
        blobStore.remove(forKey: deviceActivityPolicyClearIntentStorageKey)
        guard blobStore.read(forKey: deviceActivityPolicyClearIntentStorageKey) == nil else {
            throw PCAProtectionPolicyApplicationError.persistenceFailed
        }
    }

    private static func isValidClearIntent(_ intent: DeviceActivityPolicyClearIntent) -> Bool {
        // Keep the clear recovery record aligned with PolicySyncDecoder's
        // accepted opaque activity ID limit. A valid active generation must
        // always be clearable, including after an interrupted tombstone write.
        guard !intent.policyActivityId.isEmpty, intent.policyActivityId.utf8.count <= 256 else { return false }
        guard let installation = intent.installation else { return true }
        guard installation.policyActivityId.utf8.elementsEqual(intent.policyActivityId.utf8),
              let bytes = try? JSONEncoder().encode(installation) else { return false }
        return DeviceActivityMonitorInstallation.decodeValidated(bytes) == installation
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

    private func writeRetirementIntent(for installation: DeviceActivityMonitorInstallation) throws {
        guard installation.state == .active,
              let installationBytes = try? JSONEncoder().encode(installation),
              DeviceActivityMonitorInstallation.decodeValidated(installationBytes) == installation else {
            throw PCAProtectionPolicyApplicationError.persistenceFailed
        }
        let data = try JSONEncoder().encode(DeviceActivityPolicyRetirementIntent(previousInstallation: installation))
        guard data.count <= 262_144 else { throw PCAProtectionPolicyApplicationError.persistenceFailed }
        try blobStore.write(data, forKey: deviceActivityPolicyRetirementIntentStorageKey)
        guard blobStore.read(forKey: deviceActivityPolicyRetirementIntentStorageKey) == data else {
            throw PCAProtectionPolicyApplicationError.persistenceFailed
        }
    }

    /// A replacement commit can be interrupted after publishing its new
    /// manifest but before retiring the prior payload generation. The intent
    /// is written before that commit and is actionable only when a different,
    /// validated active manifest is now authoritative.
    private func reconcileRetirementIntent() {
        guard let intent = loadRetirementIntent(),
              let manifestData = blobStore.read(forKey: deviceActivityMonitorInstallationStorageKey),
              let current = DeviceActivityMonitorInstallation.decodeValidated(manifestData),
              current.state == .active else { return }
        if current == intent.previousInstallation {
            blobStore.remove(forKey: deviceActivityPolicyRetirementIntentStorageKey)
            return
        }
        retire(intent.previousInstallation)
        blobStore.remove(forKey: deviceActivityPolicyRetirementIntentStorageKey)
    }

    private func clearRetirementIntent(ifMatching installation: DeviceActivityMonitorInstallation) {
        guard let intent = loadRetirementIntent(), intent.previousInstallation == installation else { return }
        blobStore.remove(forKey: deviceActivityPolicyRetirementIntentStorageKey)
    }

    private func loadRetirementIntent() -> DeviceActivityPolicyRetirementIntent? {
        guard let data = blobStore.read(forKey: deviceActivityPolicyRetirementIntentStorageKey) else { return nil }
        guard data.count <= 262_144,
              (try? StrictJSONDocument.validateNoDuplicateMembers(data, maximumBytes: 262_144)) != nil,
              let intent = try? JSONDecoder().decode(DeviceActivityPolicyRetirementIntent.self, from: data),
              intent.previousInstallation.state == .active,
              let installationBytes = try? JSONEncoder().encode(intent.previousInstallation),
              DeviceActivityMonitorInstallation.decodeValidated(installationBytes) == intent.previousInstallation else {
            blobStore.remove(forKey: deviceActivityPolicyRetirementIntentStorageKey)
            return nil
        }
        return intent
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
        do {
            return try policyCoordination.withExclusiveAccessContext { access in
                // Reconcile before taking mutationLock; reconciliation owns
                // that lock while clearing persisted and system policy state.
                try reconcileClearIntent()
                mutationLock.lock()
                defer { mutationLock.unlock() }
                reconcileRetirementIntent()
                guard let installation = currentInstallation(), installation.state == .active else {
                    return .unknown
                }
                if startupRecoveryDeferred {
                    markStartupRecoveryRequired(for: installation)
                    startupRecoveryDeferred = false
                }
                if startupRecoveryFailureGeneration != nil &&
                    startupRecoveryFailureGeneration != installation.generation {
                    // Another runtime instance may have replaced the manifest
                    // after this instance's failed startup. Reconcile the exact
                    // generation currently committed before reporting health.
                    markStartupRecoveryRequired(for: installation)
                }
                guard authorizationIsApproved() else {
                    // Approval can be revoked after startup recovery succeeded.
                    // Recent callback receipts do not prove ManagedSettings or
                    // DeviceActivity remains authorized; require exact-generation
                    // reconciliation if approval is later restored.
                    markStartupRecoveryRequired(for: installation)
                    shieldEnforcer.removeAll()
                    return .enforcementUnavailable
                }
                let trustedNow: Date
                do { trustedNow = try trustedTimeFloor.observe(now, access: access) }
                catch {
                    markStartupRecoveryRequired(for: installation)
                    return .enforcementUnavailable
                }
                if startupMonitorFailureGeneration == installation.generation {
                    do {
                        try restoreMissingMonitors(for: installation)
                        startupMonitorFailureGeneration = nil
                    } catch {
                        return .enforcementUnavailable
                    }
                }
                var usageActivatedDuringRetry = false
                if startupUsageFailureGeneration == installation.generation {
                    guard let usagePlan = installation.usageDayPlan else {
                        return .enforcementUnavailable
                    }
                    do {
                        try pendingUsageActivator(usagePlan)
                        startupUsageFailureGeneration = nil
                        usageActivatedDuringRetry = true
                    } catch {
                        return .enforcementUnavailable
                    }
                }
                if startupEnforcementFailureGeneration == installation.generation {
                    if !usageActivatedDuringRetry, let usagePlan = installation.usageDayPlan {
                        // A post-commit settings retry may follow an interrupted
                        // activation even when the original error was not
                        // separately classified. Activation is idempotent when
                        // no staged record remains and preserves it on failure.
                        do { try pendingUsageActivator(usagePlan) }
                        catch {
                            startupUsageFailureGeneration = installation.generation
                            return .enforcementUnavailable
                        }
                    }
                    do {
                        try restoreCommittedEnforcement(for: installation, now: trustedNow)
                        startupEnforcementFailureGeneration = nil
                    } catch {
                        return .enforcementUnavailable
                    }
                }
                guard let callbackLog = callbackLog,
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
                    now: trustedNow,
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
                    nowUtc: trustedNow
                )
            }
        } catch {
            // Coordination was unavailable before callbackHealth acquired
            // mutationLock. Read the marker under that lock to avoid racing a
            // committed apply's post-reconcile update; do not invert lock order.
            mutationLock.lock()
            defer { mutationLock.unlock() }
            if blobStore.read(forKey: deviceActivityPolicyClearIntentStorageKey) != nil {
                return .enforcementUnavailable
            }
            return !startupRecoveryDeferred && startupMonitorFailureGeneration == nil &&
                startupUsageFailureGeneration == nil && startupEnforcementFailureGeneration == nil
                ? .unknown : .enforcementUnavailable
        }
    }

    private var startupRecoveryFailureGeneration: String? {
        startupMonitorFailureGeneration ?? startupUsageFailureGeneration ?? startupEnforcementFailureGeneration
    }

    private func hasStartupRecoveryFailure(for installation: DeviceActivityMonitorInstallation) -> Bool {
        startupMonitorFailureGeneration == installation.generation ||
            startupUsageFailureGeneration == installation.generation ||
            startupEnforcementFailureGeneration == installation.generation
    }

    private func markStartupRecoveryRequired(for installation: DeviceActivityMonitorInstallation) {
        startupMonitorFailureGeneration = installation.generation
        startupUsageFailureGeneration = installation.usageDayPlan == nil ? nil : installation.generation
        startupEnforcementFailureGeneration = installation.generation
    }

    /// Revalidate FamilyControls at the last local settings mutation boundary.
    /// If approval changed while monitors were being restored or registered,
    /// retain the committed policy for recovery but leave no stale shields or
    /// callback-capable monitors active until authorization returns.
    private func requireEnforcementAuthorization(for installation: DeviceActivityMonitorInstallation) throws {
        guard authorizationIsApproved() else {
            markStartupRecoveryRequired(for: installation)
            for id in installation.allMonitorActivityIds { scheduler.stop(activityId: id) }
            shieldEnforcer.removeAll()
            throw PCAProtectionPolicyApplicationError.authorizationRequired
        }
    }

    /// Replays the exact durable startup state in dependency order. In
    /// particular, staged usage is merged before its enforcement decision can
    /// be declared restored; failures leave a generation-scoped retry marker.
    private func recoverStartupState(for installation: DeviceActivityMonitorInstallation, now: Date) {
        do {
            try restoreMissingMonitors(for: installation)
            startupMonitorFailureGeneration = nil
        } catch {
            startupMonitorFailureGeneration = installation.generation
        }
        if let usagePlan = installation.usageDayPlan {
            do {
                try pendingUsageActivator(usagePlan)
                startupUsageFailureGeneration = nil
            } catch {
                startupUsageFailureGeneration = installation.generation
                startupEnforcementFailureGeneration = installation.generation
                return
            }
        } else {
            startupUsageFailureGeneration = nil
        }
        do {
            try restoreCommittedEnforcement(for: installation, now: now)
            startupEnforcementFailureGeneration = nil
        } catch {
            startupEnforcementFailureGeneration = installation.generation
        }
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

    private func restoreCommittedEnforcement(for installation: DeviceActivityMonitorInstallation,
                                             now: Date) throws {
        guard installation.state == .active,
              let manifestData = blobStore.read(forKey: deviceActivityMonitorInstallationStorageKey),
              DeviceActivityMonitorInstallation.decodeValidated(manifestData) == installation,
              let snapshot = StoredDeviceActivityPolicyLoader<ApplicationToken>(scheduleStore: blobStore, tokenStore: blobStore)
                .load(activityId: installation.policyActivityId, storageGeneration: installation.payloadStorageGeneration),
              snapshot.schedule.activityId.utf8.elementsEqual(installation.policyActivityId.utf8),
              blobStore.read(forKey: deviceActivityMonitorInstallationStorageKey) == manifestData else {
            throw PCAProtectionPolicyApplicationError.malformedPolicy
        }

        try requireEnforcementAuthorization(for: installation)

        var observationPlan: DeviceActivityUsageDayPlan?
        var coverageAvailable = false
        if let plan = installation.usageDayPlan,
           snapshot.schedule.dailyLimit != nil,
           plan.binding.matches(snapshot.applicationTokens, logicalAppToken: snapshot.schedule.appToken),
           plan.policyTimeZoneIdentifier.utf8.elementsEqual(snapshot.schedule.timeZone.identifier.utf8),
           now >= plan.dayStartUtc, now < plan.dayEndUtc {
            observationPlan = plan
            coverageAvailable = plan.coverage == .wholePolicyDayPlanned &&
                plan.contains(now, deviceTimeZone: deviceTimeZone())
        }

        let reconciled = try DeviceActivityUsageEnforcement.reconcile(
            policy: snapshot.schedule, now: now,
            applications: snapshot.applicationTokens,
            protectedApplications: snapshot.protectedApplicationTokens,
            deviceTimeZone: deviceTimeZone(),
            coverageAvailable: coverageAvailable,
            loadLowerBound: {
                guard let observationPlan else { return nil }
                return try DeviceActivityUsageLowerBoundStore<ApplicationToken>(store: self.blobStore)
                    .lowerBound(for: observationPlan)
            },
            apply: {
                // Foreground/startup reconciliation also has a final
                // ManagedSettings boundary after policy and usage evaluation.
                try self.requireEnforcementAuthorization(for: installation)
                try self.shieldEnforcer.apply(applications: $0,
                    protectedApplications: snapshot.protectedApplicationTokens)
            },
            remove: { self.shieldEnforcer.removeAll() })
        guard reconciled,
              blobStore.read(forKey: deviceActivityMonitorInstallationStorageKey) == manifestData else {
            throw PCAProtectionPolicyApplicationError.persistenceFailed
        }
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
