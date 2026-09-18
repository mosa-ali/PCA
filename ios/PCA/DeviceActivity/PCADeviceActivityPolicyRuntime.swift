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
    func start(activityId: String) throws
    func stop(activityId: String)
}

public final class SystemPCADeviceActivityScheduler: PCADeviceActivityScheduler {
    private let center: DeviceActivityCenter

    public init(center: DeviceActivityCenter = DeviceActivityCenter()) {
        self.center = center
    }

    public func start(activityId: String) throws {
        // The schedule is deliberately a technical all-day callback envelope.
        // ScheduleEngine remains the only authority for time-of-day, weekday,
        // exception, bonus, and daily-limit semantics inside each callback.
        try center.startMonitoring(
            DeviceActivityName(activityId),
            during: DeviceActivityScheduleMapper.monitoringSchedule(),
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

    public init(
        authorizationIsApproved: @escaping () -> Bool,
        scheduler: PCADeviceActivityScheduler = SystemPCADeviceActivityScheduler(),
        blobStore: OpaqueBlobStore,
        callbackLog: CallbackObservationLog? = nil
    ) {
        self.authorizationIsApproved = authorizationIsApproved
        self.scheduler = scheduler
        self.blobStore = blobStore
        self.callbackLog = callbackLog
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

        do {
            try blobStore.write(scheduleData, forKey: "schedule.\(policy.activityId)")
            try blobStore.write(applicationTokenData, forKey: "applicationTokens.\(policy.activityId)")
            try blobStore.write(Data(policy.activityId.utf8), forKey: "activeActivityId")
            if let protectedApplicationTokenData = protectedApplicationTokenData {
                try blobStore.write(protectedApplicationTokenData, forKey: "protectedApplicationTokens")
            } else {
                blobStore.remove(forKey: "protectedApplicationTokens")
            }
        } catch {
            throw PCAProtectionPolicyApplicationError.persistenceFailed
        }

        do {
            try scheduler.start(activityId: policy.activityId)
        } catch {
            throw PCAProtectionPolicyApplicationError.schedulingFailed
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
        scheduler.stop(activityId: activityId)
        blobStore.remove(forKey: "schedule.\(activityId)")
        blobStore.remove(forKey: "applicationTokens.\(activityId)")
        blobStore.remove(forKey: "activeActivityId")
        ManagedSettingsStore().shield.applications = nil
        ManagedSettingsStore().shield.applicationCategories = nil
        ManagedSettingsStore().shield.webDomains = nil
    }

    public func callbackHealth(now: Date) -> DeviceActivityCallbackHealth {
        guard let callbackLog = callbackLog,
              let activityIdData = blobStore.read(forKey: "activeActivityId"),
              let activityId = String(data: activityIdData, encoding: .utf8),
              !activityId.isEmpty,
              let policyData = blobStore.read(forKey: "schedule.\(activityId)"),
              case .success(let policy) = PolicySyncDecoder.decode(policyData) else {
            return .unknown
        }

        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = policy.timeZone
        let todayStart = calendar.startOfDay(for: now)
        let tomorrowStart = calendar.date(byAdding: .day, value: 1, to: todayStart) ?? now
        let todayEnd = calendar.date(byAdding: .second, value: -1, to: tomorrowStart) ?? now
        let yesterdayEnd = calendar.date(byAdding: .second, value: -1, to: todayStart) ?? now
        var expected: [ExpectedCallback] = []
        if now.timeIntervalSince(todayStart) > 120 {
            expected.append(ExpectedCallback(kind: .intervalDidStart, expectedNoLaterThan: todayStart))
        }
        if now > todayEnd.addingTimeInterval(120) {
            expected.append(ExpectedCallback(kind: .intervalDidEnd, expectedNoLaterThan: todayEnd))
        } else if now > yesterdayEnd.addingTimeInterval(120) {
            expected.append(ExpectedCallback(kind: .intervalDidEnd, expectedNoLaterThan: yesterdayEnd))
        }
        return DeviceActivityCallbackReconciler.reconcile(
            expected: expected,
            observed: callbackLog.readAll().map(\.asObservedCallback),
            nowUtc: now
        )
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
