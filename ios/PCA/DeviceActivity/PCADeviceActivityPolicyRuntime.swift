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
/// Narrow scheduler port so policy persistence/application can be tested
/// without invoking Apple's process-bound DeviceActivity center.
public protocol PCADeviceActivityScheduler {
    func start(activityId: String, calendar: Calendar) throws
    func stop(activityId: String)
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

    public init(
        authorizationIsApproved: @escaping () -> Bool,
        scheduler: PCADeviceActivityScheduler = SystemPCADeviceActivityScheduler(),
        blobStore: OpaqueBlobStore,
        callbackLog: CallbackObservationLog? = nil,
        installationClock: @escaping () -> Date = Date.init
    ) {
        self.authorizationIsApproved = authorizationIsApproved
        self.scheduler = scheduler
        self.blobStore = blobStore
        self.callbackLog = callbackLog
        self.installationClock = installationClock
    }

    public func applyVerifiedPolicy(
        scheduleData: Data,
        applicationTokenData: Data,
        protectedApplicationTokenData: Data?,
        now: Date
    ) throws -> PCAProtectionPolicyApplicationResult {
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

        // Invalidate the prior installation before replacing the policy or
        // schedule. A failed replacement must not let old callbacks certify
        // the new policy. Per-install monitor names also keep late callbacks
        // from a previous schedule distinct, including same-policy reinstall.
        let previousInstallation = currentInstallation()
        let previousActiveId = currentActiveActivityId()
        blobStore.remove(forKey: deviceActivityMonitorInstallationStorageKey)
        blobStore.remove(forKey: "activeActivityId")
        if let previousInstallation {
            scheduler.stop(activityId: previousInstallation.monitorActivityId)
        } else if let previousActiveId {
            // Stop a legacy monitor from before generation-tagged names were
            // introduced. Its callback cannot qualify health without metadata.
            scheduler.stop(activityId: previousActiveId)
        }

        let monitoringCalendar = DeviceActivityScheduleMapper.monitoringCalendar()
        do {
            try blobStore.write(scheduleData, forKey: "schedule.\(policy.activityId)")
            try blobStore.write(applicationTokenData, forKey: "applicationTokens.\(policy.activityId)")
            if let protectedApplicationTokenData = protectedApplicationTokenData {
                try blobStore.write(protectedApplicationTokenData, forKey: "protectedApplicationTokens")
            } else {
                blobStore.remove(forKey: "protectedApplicationTokens")
            }
        } catch {
            blobStore.remove(forKey: deviceActivityMonitorInstallationStorageKey)
            blobStore.remove(forKey: "activeActivityId")
            throw PCAProtectionPolicyApplicationError.persistenceFailed
        }

        let installation = DeviceActivityMonitorInstallation(
            policyActivityId: policy.activityId,
            monitorActivityId: "pca-monitor-\(UUID().uuidString.lowercased())",
            generation: UUID().uuidString.lowercased(),
            installedAtUtc: installationClock(),
            timeZoneIdentifier: monitoringCalendar.timeZone.identifier,
            state: .starting
        )
        do {
            // Publish the active policy only after every payload and the
            // starting record are present. Legacy callbacks are gated on this
            // key and cannot observe a partial replacement.
            try writeInstallation(installation)
            try blobStore.write(Data(policy.activityId.utf8), forKey: "activeActivityId")
        } catch {
            blobStore.remove(forKey: deviceActivityMonitorInstallationStorageKey)
            blobStore.remove(forKey: "activeActivityId")
            throw PCAProtectionPolicyApplicationError.persistenceFailed
        }

        do {
            try scheduler.start(activityId: installation.monitorActivityId, calendar: monitoringCalendar)
        } catch {
            blobStore.remove(forKey: deviceActivityMonitorInstallationStorageKey)
            blobStore.remove(forKey: "activeActivityId")
            scheduler.stop(activityId: installation.monitorActivityId)
            throw PCAProtectionPolicyApplicationError.schedulingFailed
        }

        do {
            try writeInstallation(installation.confirmingActive())
        } catch {
            blobStore.remove(forKey: deviceActivityMonitorInstallationStorageKey)
            blobStore.remove(forKey: "activeActivityId")
            scheduler.stop(activityId: installation.monitorActivityId)
            throw PCAProtectionPolicyApplicationError.persistenceFailed
        }

        let adapter = ManagedSettingsAdapter(
            protectedApplicationTokens: protectedTokens,
            protectedCategoryTokens: []
        )
        let decision = ScheduleEngine.evaluate(ScheduleEvaluationInput(
            nowUtc: now,
            timeZone: policy.timeZone,
            appToken: policy.appToken,
            windows: policy.windows,
            bonusGrants: policy.bonusGrants,
            exceptions: policy.exceptions,
            dailyLimit: policy.dailyLimit,
            enforcementCapability: policy.enforcementCapability
        ))

        if decision.isRestrictive || decision.kind == .enforcementUnavailable {
            try adapter.apply(applications: applicationTokens, categories: [])
        } else {
            adapter.removeAll()
        }

        switch policy.enforcementCapability {
        case .enforced:
            return .applied
        case .degraded, .unavailable:
            return .degraded
        }
    }

    public func clearPolicy(activityId: String) {
        let installation = currentInstallation()
        let activeActivityId = currentActiveActivityId()
        if let installation, installation.policyActivityId == activityId {
            scheduler.stop(activityId: installation.monitorActivityId)
            blobStore.remove(forKey: deviceActivityMonitorInstallationStorageKey)
        } else if activeActivityId == activityId {
            scheduler.stop(activityId: activityId)
            blobStore.remove(forKey: deviceActivityMonitorInstallationStorageKey)
        }
        blobStore.remove(forKey: "schedule.\(activityId)")
        blobStore.remove(forKey: "applicationTokens.\(activityId)")
        if activeActivityId == activityId {
            blobStore.remove(forKey: "activeActivityId")
        }
        ManagedSettingsStore().shield.applications = nil
        ManagedSettingsStore().shield.applicationCategories = nil
        ManagedSettingsStore().shield.webDomains = nil
    }

    public func callbackHealth(now: Date) -> DeviceActivityCallbackHealth {
        guard let callbackLog = callbackLog,
              let installation = currentInstallation(),
              installation.state == .active,
              currentActiveActivityId() == installation.policyActivityId,
              let timeZone = TimeZone(identifier: installation.timeZoneIdentifier),
              let policyData = blobStore.read(forKey: "schedule.\(installation.policyActivityId)"),
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
    }

    public static func production(
        authorizationIsApproved: @escaping () -> Bool,
        appGroupIdentifier: String
    ) throws -> PCAProductionProtectionPolicyRuntime {
        let blobStore = try AppGroupBlobStore(appGroupIdentifier: appGroupIdentifier)
        let callbackLog = try? AppGroupCallbackObservationLog(appGroupIdentifier: appGroupIdentifier)
        return PCAProductionProtectionPolicyRuntime(
            authorizationIsApproved: authorizationIsApproved,
            blobStore: blobStore,
            callbackLog: callbackLog
        )
    }
}
#endif
