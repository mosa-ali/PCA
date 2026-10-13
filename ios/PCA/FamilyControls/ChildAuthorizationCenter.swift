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

public enum RawAuthorizationStatus: String, Equatable, Sendable, Codable {
    case notDetermined = "NOT_DETERMINED"
    case denied = "DENIED"
    case approved = "APPROVED"
}

/// Stores only the last observed public authorization status so an app
/// restart does not erase evidence of a revocation that happened while the
/// process was stopped. This value is informational: every refresh still
/// reads the live FamilyControls status before deciding whether enforcement
/// is permitted.
public protocol ChildAuthorizationObservationStore {
    func loadLastObservedStatus() -> RawAuthorizationStatus?
    func saveLastObservedStatus(_ status: RawAuthorizationStatus)
    /// Atomically returns the previous status and records the current one.
    func recordObservedStatus(_ status: RawAuthorizationStatus) -> RawAuthorizationStatus?
}

public final class UserDefaultsChildAuthorizationObservationStore: ChildAuthorizationObservationStore {
    private static let observationLock = NSLock()
    private let defaults: UserDefaults
    private let key: String

    public init(defaults: UserDefaults = .standard,
                key: String = "org.pca.child-authorization.last-observed-status") {
        self.defaults = defaults
        self.key = key
    }

    public func loadLastObservedStatus() -> RawAuthorizationStatus? {
        Self.observationLock.lock()
        defer { Self.observationLock.unlock() }
        return loadUnlocked()
    }

    public func saveLastObservedStatus(_ status: RawAuthorizationStatus) {
        Self.observationLock.lock()
        defer { Self.observationLock.unlock() }
        defaults.set(status.rawValue, forKey: key)
    }

    public func recordObservedStatus(_ status: RawAuthorizationStatus) -> RawAuthorizationStatus? {
        Self.observationLock.lock()
        defer { Self.observationLock.unlock() }
        let previous = loadUnlocked()
        defaults.set(status.rawValue, forKey: key)
        return previous
    }

    private func loadUnlocked() -> RawAuthorizationStatus? {
        guard defaults.object(forKey: key) != nil else { return nil }
        guard let rawValue = defaults.string(forKey: key) else {
            defaults.removeObject(forKey: key)
            return nil
        }
        guard let status = RawAuthorizationStatus(rawValue: rawValue) else {
            defaults.removeObject(forKey: key)
            return nil
        }
        return status
    }
}

/// In-memory observation storage for tests and previews.
public final class InMemoryChildAuthorizationObservationStore: ChildAuthorizationObservationStore {
    private let lock = NSLock()
    private var status: RawAuthorizationStatus?

    public init(status: RawAuthorizationStatus? = nil) {
        self.status = status
    }

    public func loadLastObservedStatus() -> RawAuthorizationStatus? {
        lock.lock(); defer { lock.unlock() }
        return status
    }
    public func saveLastObservedStatus(_ status: RawAuthorizationStatus) {
        lock.lock(); defer { lock.unlock() }
        self.status = status
    }
    public func recordObservedStatus(_ status: RawAuthorizationStatus) -> RawAuthorizationStatus? {
        lock.lock(); defer { lock.unlock() }
        let previous = self.status
        self.status = status
        return previous
    }
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
    /// Keep sampling Apple's live status and committing the corresponding prior-state observation
    /// in one process-wide critical section. Without this, two app/runtime callers can interleave:
    /// a stale `.approved` sample may be persisted after a newer `.denied` sample and briefly
    /// re-open an enforcement gate.
    private static let refreshLock = NSLock()
    private let source: AuthorizationStatusSource
    private let observationStore: ChildAuthorizationObservationStore

    public init(source: AuthorizationStatusSource,
                observationStore: ChildAuthorizationObservationStore = UserDefaultsChildAuthorizationObservationStore()) {
        self.source = source
        self.observationStore = observationStore
    }

    /// Re-reads the raw status and returns the doc-07 state, including a
    /// `.revoked` transition if the previously-observed status was
    /// `.approved` and the new one is not.
    @discardableResult
    public func refresh() -> ChildAuthorizationState {
        Self.refreshLock.lock()
        defer { Self.refreshLock.unlock() }
        let raw = source.currentRawStatus()
        let previous = observationStore.recordObservedStatus(raw)

        if previous == .approved, raw != .approved {
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
        } catch is CancellationError {
            // Cancellation is caller lifecycle control, not evidence that
            // FamilyControls is unsupported. Re-read the live state and keep
            // the nonthrowing API's result truthful.
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
