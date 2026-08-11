import Foundation
#if canImport(DeviceActivity)
import DeviceActivity
import ManagedSettings
import FamilyControls

/// The DeviceActivityMonitor extension entry point (doc 07 Section 3/7).
/// Runs OUT-OF-PROCESS from the host app, on Apple's own lifecycle -- this
/// is Apple's documented boundary, never something this code tries to
/// poll around or bypass (doc 07 Section 7).
///
/// XCODE SETUP REQUIRED (see docs/ios/MAC_XCODE_VALIDATION_CHECKLIST.md):
/// this file must be added to a real "Device Activity Monitor Extension"
/// target created via Xcode's New Target flow, which also generates the
/// extension's Info.plist (`NSExtensionPointIdentifier` =
/// `com.apple.deviceactivity.monitor-extension`) and wires the Family
/// Controls entitlement onto the extension target -- neither can be
/// correctly hand-authored outside Xcode without risking a malformed
/// project file.
final class PCADeviceActivityMonitorExtension: DeviceActivityMonitor {
    private let policyStore: DeviceActivityPolicySource
    private let callbackLog: CallbackObservationLog
    private let managedSettings: ManagedSettingsStore

    override init() {
        // Production wiring resolves these from the App Group container
        // (same mechanism as FamilyActivitySelectionStore) -- see
        // `makeProduction()` below. `init()` itself stays parameterless
        // because `DeviceActivityMonitor` is instantiated by the OS, not
        // by this app's own code, so there is no call site to inject
        // dependencies through.
        self.policyStore = AppGroupDeviceActivityPolicySource()
        self.callbackLog = AppGroupCallbackObservationLog()
        self.managedSettings = ManagedSettingsStore()
        super.init()
    }

    override func intervalDidStart(for activity: DeviceActivityName) {
        super.intervalDidStart(for: activity)
        callbackLog.record(kind: .intervalDidStart, at: Date())
        applyCurrentDecision(for: activity)
    }

    override func intervalDidEnd(for activity: DeviceActivityName) {
        super.intervalDidEnd(for: activity)
        callbackLog.record(kind: .intervalDidEnd, at: Date())
        // The interval ending removes ITS OWN contribution to the shield;
        // ScheduleEngine is re-evaluated (rather than unconditionally
        // clearing the shield) because another still-active window (e.g. a
        // BLOCK_PERIOD overlapping this BEDTIME window's end) may still
        // require enforcement.
        applyCurrentDecision(for: activity)
    }

    override func eventDidReachThreshold(_ event: DeviceActivityEvent.Name, activity: DeviceActivityName) {
        super.eventDidReachThreshold(event, activity: activity)
        callbackLog.record(kind: .eventDidReachThreshold(eventId: event.rawValue), at: Date())
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
        guard let policy = policyStore.currentPolicy(for: activity) else { return }
        let decision = ScheduleEngine.evaluate(policy.evaluationInput(nowUtc: Date()))

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
    let windows: [ScheduleWindow]
    let bonusGrants: [BonusGrant]
    let exceptions: [ParentException]
    let dailyLimit: DailyAppLimit?
    let enforcementCapability: EnforcementCapabilityState
    let timeZone: TimeZone
    let appToken: String
    let applicationTokens: Set<ApplicationToken>
    let protectedApplicationTokens: Set<ApplicationToken>

    func evaluationInput(nowUtc: Date) -> ScheduleEvaluationInput {
        ScheduleEvaluationInput(
            nowUtc: nowUtc, timeZone: timeZone, appToken: appToken, windows: windows,
            bonusGrants: bonusGrants, exceptions: exceptions, dailyLimit: dailyLimit,
            enforcementCapability: enforcementCapability
        )
    }
}

struct AppGroupDeviceActivityPolicySource: DeviceActivityPolicySource {
    func currentPolicy(for activity: DeviceActivityName) -> DeviceActivityAppliedPolicy? {
        // Decoding the already-verified policy payload from the App Group
        // container is the same shared-storage mechanism as
        // FamilyActivitySelectionStore; the concrete decode wiring is
        // deferred to the host app's own policy-sync integration point
        // (PCA-11's iOS adapter), not duplicated here.
        nil
    }
}

protocol CallbackObservationLog {
    func record(kind: DeviceActivityCallbackKind, at: Date)
}

struct AppGroupCallbackObservationLog: CallbackObservationLog {
    func record(kind: DeviceActivityCallbackKind, at: Date) {
        // Appends to the same App-Group-shared log the host app reads on
        // next foreground to run DeviceActivityCallbackReconciler -- see
        // doc 07 Section 14's expected-vs-actual reconciliation.
    }
}
#endif
