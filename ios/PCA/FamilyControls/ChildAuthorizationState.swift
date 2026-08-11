import Foundation

/// Mirrors `AuthorizationCenter.AuthorizationStatus` (FamilyControls) plus the
/// states doc 07 Section 14 requires be surfaced honestly: entitlement
/// unavailability and a revoked-after-grant transition. Never collapse any
/// of these into a bare "protected"/"not protected" boolean -- the parent
/// UI must be able to show *why* enforcement is or isn't active.
///
/// doc 07 PCA-IOS-001/PCA-IOS-002: this state is read ONLY via
/// `AuthorizationCenter.shared.authorizationStatus`, the public Family
/// Controls API. No private API, no runtime introspection.
public enum ChildAuthorizationState: Equatable, Sendable {
    /// `AuthorizationCenter.shared.authorizationStatus == .notDetermined`.
    /// The parent has not yet been asked / has not yet responded.
    case notDetermined

    /// Authorization request denied by the parent/guardian, or the child
    /// account does not currently satisfy Family Controls' requirements
    /// (see doc 07 Section 16 -- Family Sharing + child account setup).
    case denied

    /// `authorizationStatus == .approved`. Shields/monitoring MAY be
    /// enforced. This is a snapshot, not a guarantee it stays true -- see
    /// `revokedSinceLastCheck`.
    case approved

    /// The device previously observed `.approved` and now observes
    /// anything other than `.approved` (doc 07 Section 14, first failure
    /// row: "Family Controls authorization revoked ... app surfaces this
    /// ... as an out-of-band change rather than silently reporting stale
    /// 'protected' status"). Carries the newly-observed raw state so the
    /// UI can distinguish "revoked back to denied" from "revoked back to
    /// not-determined."
    case revoked(to: ChildAuthorizationState.RevocationTarget)

    /// The Family Controls entitlement itself is unavailable to this
    /// build/account (doc 07 Section 11 fallback) -- distinct from
    /// `.denied`, which presumes the entitlement exists but the parent
    /// declined. Detected indirectly: `requestAuthorization` throwing a
    /// framework error consistent with missing entitlement/restricted
    /// environment, never assumed proactively without that signal.
    case entitlementUnavailable

    public enum RevocationTarget: Equatable, Sendable {
        case notDetermined
        case denied
    }

    /// True only for `.approved` -- every other case must degrade
    /// enforcement-dependent UI, never claim "protected" (doc 07 Section 14).
    public var permitsEnforcement: Bool {
        self == .approved
    }
}
