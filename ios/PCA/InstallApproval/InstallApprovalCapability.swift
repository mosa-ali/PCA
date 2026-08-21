import Foundation

/// CAPABILITY_HONEST_INSTALL_APPROVAL (PCA-FR-131, cross-referenced from PCA-FR-045): the shared,
/// cross-platform install-approval capability vocabulary. Mirrors
/// `backend/src/childrequests/types.ts`'s `InstallApprovalCapabilityState` and Android's
/// `org.pca.app.feature.installapproval.InstallApprovalCapabilityState` verbatim (same raw string
/// values) -- the SAME state name means the same thing on every surface, never re-interpreted per
/// platform.
public enum InstallApprovalCapability: String, Equatable, Sendable {
    case enforced = "ENFORCED"
    case requestOnly = "REQUEST_ONLY"
    case authorizationRequired = "AUTHORIZATION_REQUIRED"
    case notSupported = "NOT_SUPPORTED"
    case platformLimited = "PLATFORM_LIMITED"
}

/// Resolves this device's ACTUAL install-approval capability, staying strictly within what
/// Apple's public Family Controls / ManagedSettings / DeviceActivity APIs document (doc 07 — iOS
/// Architecture) — see `README.md`'s "no private API" scope boundary, restated per-feature here.
///
/// This is a CATEGORICAL, always-`.notSupported` resolver, not a placeholder pending a future
/// entitlement: nothing in `ios/PCA`'s dependency set (FamilyControls, ManagedSettings,
/// DeviceActivity) exposes any event, callback, or query that observes a NEW APP INSTALL on the
/// device, at all:
///
///  - `ManagedSettingsStore.shield.applications` (see `ManagedSettings/ManagedSettingsAdapter.swift`)
///    can only shield an `ApplicationToken` the PARENT already selected via `FamilyActivityPicker`
///    from apps CURRENTLY installed at picker time — there is no token for an app that does not
///    exist yet, so a not-yet-installed app can never be pre-shielded, and the picker itself has
///    no "notify me when something new gets installed" callback.
///  - `DeviceActivityMonitor`'s extension callbacks (`intervalDidStart`/`eventDidReachThreshold`/
///    etc. — see `PCADeviceActivityMonitor/DeviceActivityMonitorExtension.swift`) fire on
///    SCHEDULE/THRESHOLD events for activity the parent already configured monitoring for; none
///    of them fire on install.
///  - There is no public, non-MDM "app was installed" notification available to an ordinary iOS
///    app at all (unlike Android's documented `PACKAGE_ADDED` system broadcast — see
///    `android/app/src/main/java/org/pca/app/runtime/installobserver/InstalledAppEventReceiver.kt`).
///
/// This is therefore a genuine, permanent platform ceiling under the public API set doc 07 commits
/// to (AD-B-001/doc 01 Section 5's "no private API" boundary) — not a temporary gap more
/// engineering effort could close, and not something this module works around: there is no
/// install-observer counterpart to build on iOS at all, honest or otherwise.
public enum InstallApprovalCapabilityResolver {
    /// Always `.notSupported` — see this enum's own doc comment for exactly why. Modeled as a
    /// function (not a bare constant) so a future genuine platform capability change (a new,
    /// documented Apple API) has one obvious call site to update, and so call sites read
    /// identically to Android's `InstallApprovalCapabilityResolver.resolve(...)` rather than every
    /// caller hardcoding a literal.
    public static func resolve() -> InstallApprovalCapability {
        .notSupported
    }
}
