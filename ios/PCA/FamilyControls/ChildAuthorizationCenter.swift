import Foundation
#if canImport(FamilyControls)
import FamilyControls
#endif

/// Narrow protocol over `AuthorizationCenter` (FamilyControls) so the
/// revocation-detection logic below is unit-testable on any platform,
/// including this Windows workspace, without the real framework. The
/// production conformance (`SystemAuthorizationSource`) is a thin,
/// no-logic wrapper around Apple's actual API -- see the bottom of this
/// file, compiled only where `FamilyControls` is available (device/
/// simulator builds; never on Windows).
public protocol AuthorizationStatusSource {
    /// Raw three-way status FamilyControls itself reports.
    func currentRawStatus() -> RawAuthorizationStatus
    /// `AuthorizationCenter.shared.requestAuthorization(for: .child)`.
    /// Throws if the entitlement/environment does not support the request
    /// at all (doc 07 Section 11) -- distinct from a normal `.denied` result.
    func requestChildAuthorization() async throws
}

public enum RawAuthorizationStatus: Equatable, Sendable {
    case notDetermined
    case denied
    case approved
}

/// Tracks `ChildAuthorizationState` across repeated checks, purely from
/// the raw status source above -- no FamilyControls dependency in this
/// type itself, so it is fully testable with a fake source.
///
/// doc 07 Section 14: "authorization revoked ... surfaced as an
/// out-of-band change." This type is the single place that turns a raw
/// status transition into that surfaced `.revoked` case; every caller
/// (shield application, DeviceActivity scheduling, parent status UI) must
/// consult THIS, never read `AuthorizationStatusSource` directly, so the
/// revocation signal can never be silently skipped by a call site that
/// forgot to compare against the previous observation.
public final class ChildAuthorizationCenter {
    private let source: AuthorizationStatusSource
    private var lastObserved: RawAuthorizationStatus?

    public init(source: AuthorizationStatusSource) {
        self.source = source
    }

    /// Re-reads the raw status and returns the doc-07 state, including a
    /// `.revoked` transition if the previously-observed status was
    /// `.approved` and the new one is not.
    @discardableResult
    public func refresh() -> ChildAuthorizationState {
        let raw = source.currentRawStatus()
        defer { lastObserved = raw }

        if lastObserved == .approved, raw != .approved {
            let target: ChildAuthorizationState.RevocationTarget = (raw == .denied) ? .denied : .notDetermined
            return .revoked(to: target)
        }
        switch raw {
        case .notDetermined: return .notDetermined
        case .denied: return .denied
        case .approved: return .approved
        }
    }

    /// Requests child authorization. A thrown error is surfaced as
    /// `.entitlementUnavailable` rather than propagated as a generic
    /// failure, so callers have one honest state to render (doc 07
    /// Section 11) instead of needing to interpret a framework error type.
    public func requestAuthorization() async -> ChildAuthorizationState {
        do {
            try await source.requestChildAuthorization()
            return refresh()
        } catch {
            return .entitlementUnavailable
        }
    }
}

#if canImport(FamilyControls)
/// Production conformance. Deliberately does nothing but forward to the
/// real, public `AuthorizationCenter` API (doc 07 PCA-IOS-001) -- all
/// actual logic lives in `ChildAuthorizationCenter` above, which is
/// tested independently of this type.
public struct SystemAuthorizationSource: AuthorizationStatusSource {
    public init() {}

    public func currentRawStatus() -> RawAuthorizationStatus {
        switch AuthorizationCenter.shared.authorizationStatus {
        case .notDetermined: return .notDetermined
        case .denied: return .denied
        case .approved: return .approved
        @unknown default: return .notDetermined
        }
    }

    public func requestChildAuthorization() async throws {
        try await AuthorizationCenter.shared.requestAuthorization(for: .child)
    }
}
#endif
