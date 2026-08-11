import Foundation
#if canImport(DeviceActivity)
import DeviceActivity
import ManagedSettings
import FamilyControls

/// App Group identifier this extension and the host app share. Set once
/// here (rather than scattered across call sites) so the Mac/Xcode setup
/// step (see docs/MAC_XCODE_VALIDATION_CHECKLIST.md Section 0) has a
/// single place to confirm/adjust it against the actual configured
/// capability. This value is NOT a secret -- App Group identifiers are
/// public bundle-adjacent strings, not key material.
enum AppGroup {
    static let identifier = "group.org.pca.app"
}

/// The DeviceActivityMonitor extension entry point (doc 07 Section 3/7).
/// Runs OUT-OF-PROCESS from the host app, on Apple's own lifecycle -- this
/// is Apple's documented boundary, never something this code tries to
/// poll around or bypass (doc 07 Section 7).
final class PCADeviceActivityMonitorExtension: DeviceActivityMonitor {
    private let policyStore: DeviceActivityPolicySource
    private let callbackLog: CallbackObservationLog
    private let managedSettings: ManagedSettingsStore

    override init() {
        // `DeviceActivityMonitor` is instantiated by the OS, not by this
        // app's own code, so there is no call site to inject dependencies
        // through -- production wiring is resolved here, once, from the
        // shared App Group container. If the App Group itself is
        // unavailable (misconfigured capability), both stores degrade to
        // an empty/unavailable state rather than crashing the extension
        // process (PCA-15 correction F1: "return nil / degraded state
        // only when policy genuinely unavailable").
        self.policyStore = AppGroupDeviceActivityPolicySource(appGroupIdentifier: AppGroup.identifier)
        self.callbackLog = (try? AppGroupCallbackObservationLog(appGroupIdentifier: AppGroup.identifier)) ?? InMemoryCallbackObservationLog()
        self.managedSettings = ManagedSettingsStore()
        super.init()
    }

    override func intervalDidStart(for activity: DeviceActivityName) {
        super.intervalDidStart(for: activity)
        callbackLog.record(kind: .intervalDidStart, activityId: activity.rawValue, at: Date())
        applyCurrentDecision(for: activity)
    }

    override func intervalDidEnd(for activity: DeviceActivityName) {
        super.intervalDidEnd(for: activity)
        callbackLog.record(kind: .intervalDidEnd, activityId: activity.rawValue, at: Date())
        // The interval ending removes ITS OWN contribution to the shield;
        // ScheduleEngine is re-evaluated (rather than unconditionally
        // clearing the shield) because another still-active window (e.g. a
        // BLOCK_PERIOD overlapping this BEDTIME window's end) may still
        // require enforcement.
        applyCurrentDecision(for: activity)
    }

    override func eventDidReachThreshold(_ event: DeviceActivityEvent.Name, activity: DeviceActivityName) {
        super.eventDidReachThreshold(event, activity: activity)
        callbackLog.record(kind: .eventDidReachThreshold(eventId: event.rawValue), activityId: activity.rawValue, at: Date())
        applyCurrentDecision(for: activity)
    }

    /// Re-runs `ScheduleEngine.evaluate` against the currently-stored
    /// policy (never a cached decision) and applies/removes the shield
    /// accordingly. Every callback re-evaluates fresh rather than assuming
    /// its own trigger implies a specific decision, since precedence
    /// (parent exception, bonus time, etc.) can only be resolved by the
    /// engine at the moment of the callback, not baked into the schedule
    /// mapping ahead of time.
    private func applyCurrentDecision(for activity: DeviceActivityName) {
        guard let policy = policyStore.currentPolicy(for: activity) else {
            // Policy genuinely unavailable (never synced yet, App Group
            // unreachable, or malformed/rejected by PolicySyncDecoder) --
            // deliberately leaves the shield in whatever state it was
            // already in, rather than either inventing a restriction or
            // clearing an existing one on missing data.
            return
        }

        let validator = ShieldPolicyValidator<ApplicationToken>(
            protectedApplicationTokens: policy.protectedApplicationTokens,
            protectedCategoryTokens: []
        )
        let outcome = validator.validate(applications: policy.applicationTokens, categories: [], domains: [])
        guard case .accepted = outcome else {
            // PCA-IOS-003: never apply a shield that failed the emergency
            // safety floor, regardless of what the schedule decided.
            return
        }

        let decision = ScheduleEngine.evaluate(policy.evaluationInput(nowUtc: Date()))

        // `decision.isRestrictive` covers every fully-resolved BLOCKED_*
        // kind. `.enforcementUnavailable` (an intended-restrictive decision
        // the engine could not confirm enforceable at evaluation time, per
        // `ScheduleEngine.evaluate`'s own doc) is ALSO treated as
        // restrictive here specifically because this extension callback is
        // itself the on-device enforcement mechanism -- if code is running
        // here at all, applying the shield is the correct, safe action;
        // failing open (never shielding) on an unconfirmed-enforcement
        // signal would be the wrong default for a child-safety control.
        let shouldShield = decision.isRestrictive || decision.kind == .enforcementUnavailable
        managedSettings.shield.applications = shouldShield && !policy.applicationTokens.isEmpty ? policy.applicationTokens : nil
    }
}

/// Narrow port the extension reads its policy through -- kept as a
/// protocol so the decision-triggering logic above could, in principle, be
/// exercised with a fake in a host-app-side integration test; the extension
/// process itself always uses the App-Group-backed conformance.
protocol DeviceActivityPolicySource {
    func currentPolicy(for activity: DeviceActivityName) -> DeviceActivityAppliedPolicy?
}

struct DeviceActivityAppliedPolicy {
    let schedule: DecodedSchedulePolicy
    let applicationTokens: Set<ApplicationToken>
    let protectedApplicationTokens: Set<ApplicationToken>

    func evaluationInput(nowUtc: Date) -> ScheduleEvaluationInput {
        ScheduleEvaluationInput(
            nowUtc: nowUtc, timeZone: schedule.timeZone, appToken: schedule.appToken, windows: schedule.windows,
            bonusGrants: schedule.bonusGrants, exceptions: schedule.exceptions, dailyLimit: schedule.dailyLimit,
            enforcementCapability: schedule.enforcementCapability
        )
    }
}

/// Real App-Group-backed policy source (PCA-15 correction F1). Reads TWO
/// separate opaque payloads under per-activity keys, both written by the
/// host app once PCA-11's iOS sync adapter accepts a policy update:
///   1. the schedule JSON (`PolicySyncDecoder`, schema-versioned, fully
///      validated, never trusted blindly);
///   2. the FamilyControls token sets (`FamilyActivitySelection`-shaped
///      opaque bytes, decoded via the SAME `PropertyListDecoder` mechanism
///      as `FamilyActivitySelectionStore` -- tokens are never inspected
///      beyond that decode, preserving opacity).
/// Both must decode successfully for a policy to be considered available;
/// either failing returns `nil` (degraded), never a half-applied guess.
struct AppGroupDeviceActivityPolicySource: DeviceActivityPolicySource {
    private let scheduleBlobStore: OpaqueBlobStore?
    private let tokenBlobStore: OpaqueBlobStore?
    private let plistDecoder = PropertyListDecoder()

    init(appGroupIdentifier: String) {
        self.scheduleBlobStore = try? AppGroupBlobStore(appGroupIdentifier: appGroupIdentifier)
        self.tokenBlobStore = try? AppGroupBlobStore(appGroupIdentifier: appGroupIdentifier)
    }

    func currentPolicy(for activity: DeviceActivityName) -> DeviceActivityAppliedPolicy? {
        guard let scheduleStore = scheduleBlobStore, let tokenStore = tokenBlobStore else { return nil }

        let activityId = activity.rawValue
        guard let scheduleData = scheduleStore.read(forKey: "schedule.\(activityId)") else { return nil }
        guard case .success(let decodedSchedule) = PolicySyncDecoder.decode(scheduleData) else { return nil }

        guard let applicationTokensData = tokenStore.read(forKey: "applicationTokens.\(activityId)") else { return nil }
        guard let applicationTokens = try? plistDecoder.decode(Set<ApplicationToken>.self, from: applicationTokensData) else { return nil }

        // Protected tokens are a family-independent, device-local
        // reference set captured once during setup (see
        // ShieldSafetyValidator's doc) -- stored under a fixed key, not
        // per-activity, since the emergency floor never varies by which
        // schedule is currently evaluating.
        let protectedTokens: Set<ApplicationToken>
        if let protectedData = tokenStore.read(forKey: "protectedApplicationTokens"),
           let decoded = try? plistDecoder.decode(Set<ApplicationToken>.self, from: protectedData) {
            protectedTokens = decoded
        } else {
            protectedTokens = []
        }

        return DeviceActivityAppliedPolicy(schedule: decodedSchedule, applicationTokens: applicationTokens, protectedApplicationTokens: protectedTokens)
    }
}
#endif
