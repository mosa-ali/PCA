import Foundation

/// PCA-IOS-002: the exact scoped anti-removal copy doc 07 Section 6
/// requires -- "state the anti-removal claim with its precise scope
/// (child-account authorization active, via Family Controls) and MUST
/// NOT generalize it to 'cannot be removed from the device' without
/// qualification, consistent with the binding constraint that no
/// platform's anti-removal claim may be stated as universal."
///
/// This type is deliberately plain data (no SwiftUI dependency) so the
/// copy itself -- the thing PCA-IOS-002 is actually about -- is
/// unit-testable without a simulator/host app, the same seam pattern the
/// rest of this module uses for platform-framework boundaries. The
/// scope qualifier (`AntiRemovalClaimCopy.scopeQualifier`) is a fixed
/// constant included in every `current(for:)` result on purpose: doc
/// 07 Section 6 / doc 00's `SRC-H-A-001` row both require the
/// "not a universal claim, does not block an authorized adult recovery
/// action" qualification to travel with the claim, not just live on a
/// single "best case" screen state.
public struct AntiRemovalClaimCopy: Equatable {
    /// Short label for the state-dependent line (e.g. "Active", "Not active").
    public let statusHeadline: String
    /// One sentence describing what is/isn't currently true for this
    /// specific device, scoped to `ChildAuthorizationState`.
    public let statusDetail: String
    /// The universal, state-independent qualification. MUST be present
    /// on screen alongside every `statusHeadline`/`statusDetail` pair --
    /// callers must never render `statusDetail` alone.
    public let scopeQualifier: String

    /// Fixed across every state: this is precisely the "not a universal
    /// claim" qualification doc 07 Section 6 and doc 00 `SRC-H-A-001`
    /// require. It intentionally never varies by `ChildAuthorizationState`.
    public static let scopeQualifierText =
        "This is not a claim that PCA can never be removed from this device. " +
        "A parent or guardian can always remove PCA through Apple's supported " +
        "Family Controls settings and account recovery path. It does not " +
        "prevent an authorized adult removal action."

    public init(statusHeadline: String, statusDetail: String, scopeQualifier: String = AntiRemovalClaimCopy.scopeQualifierText) {
        self.statusHeadline = statusHeadline
        self.statusDetail = statusDetail
        self.scopeQualifier = scopeQualifier
    }

    /// The copy to show for the device's current `ChildAuthorizationState`.
    /// Every branch keeps `scopeQualifier` identical -- only the
    /// state-specific headline/detail change -- so the qualification can
    /// never be silently dropped for a particular state.
    public static func current(for state: ChildAuthorizationState) -> AntiRemovalClaimCopy {
        switch state {
        case .approved:
            return AntiRemovalClaimCopy(
                statusHeadline: "Active on this device",
                statusDetail: "Your parent or guardian has authorized PCA for this child account through " +
                    "Family Controls, so iOS currently prevents deleting this app through ordinary means."
            )
        case .notDetermined:
            return AntiRemovalClaimCopy(
                statusHeadline: "Not yet active",
                statusDetail: "This protection only takes effect after a parent or guardian completes Family " +
                    "Controls authorization for this device. It has not been requested yet."
            )
        case .denied:
            return AntiRemovalClaimCopy(
                statusHeadline: "Not active",
                statusDetail: "This protection requires an active parent/guardian Family Controls authorization, " +
                    "which is not currently granted for this device."
            )
        case .revoked:
            return AntiRemovalClaimCopy(
                statusHeadline: "Just turned off",
                statusDetail: "This protection was active but Family Controls authorization for this device has " +
                    "just changed. If this was not expected, ask your parent or guardian to check Screen Time settings."
            )
        case .entitlementUnavailable:
            return AntiRemovalClaimCopy(
                statusHeadline: "Not available",
                statusDetail: "This protection is not available on this device or account right now."
            )
        }
    }
}
