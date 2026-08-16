import XCTest
@testable import PCA

/// PCA-IOS-002: doc 07 Section 6 requires the anti-removal claim to be
/// stated "with its precise scope (child-account authorization active,
/// via Family Controls)" and to never generalize to "cannot be removed
/// from the device" without qualification. These tests pin that contract
/// at the copy level -- the same level PCA-IOS-002 is actually about --
/// independent of SwiftUI/host-app rendering.
final class AntiRemovalClaimCopyTests: XCTestCase {

    private let allStates: [ChildAuthorizationState] = [
        .notDetermined,
        .denied,
        .approved,
        .revoked(to: .denied),
        .revoked(to: .notDetermined),
        .entitlementUnavailable,
    ]

    func testEveryAuthorizationStateCarriesTheUniversalScopeQualifier() {
        // The "not a universal claim, authorized adult can always remove
        // it" qualification must never be state-dependent -- a caller
        // that only renders the good-case ".approved" screen and drops
        // the qualifier elsewhere would violate PCA-IOS-002.
        for state in allStates {
            let copy = AntiRemovalClaimCopy.current(for: state)
            XCTAssertEqual(copy.scopeQualifier, AntiRemovalClaimCopy.scopeQualifierText, "scope qualifier must be identical for \(state)")
        }
    }

    func testScopeQualifierExplicitlyDisclaimsAUniversalClaim() {
        let qualifier = AntiRemovalClaimCopy.scopeQualifierText
        XCTAssertTrue(qualifier.contains("not a claim that PCA can never be removed"))
        XCTAssertTrue(qualifier.contains("authorized adult removal action") || qualifier.contains("does not prevent an authorized adult"))
    }

    func testApprovedStateNamesTheExactAuthorizationScope() {
        // doc 07 Section 6: the claim must be scoped to "an active child
        // authorization approved by a parent/guardian" via Family
        // Controls -- not a bare "protected" statement.
        let copy = AntiRemovalClaimCopy.current(for: .approved)
        XCTAssertTrue(copy.statusDetail.contains("parent or guardian"))
        XCTAssertTrue(copy.statusDetail.contains("Family Controls"))
        XCTAssertEqual(copy.statusHeadline, "Active on this device")
    }

    func testNotDeterminedStateNeverClaimsProtectionIsActive() {
        let copy = AntiRemovalClaimCopy.current(for: .notDetermined)
        XCTAssertFalse(copy.statusDetail.lowercased().contains("prevents deleting"))
        XCTAssertTrue(copy.statusDetail.contains("not") || copy.statusHeadline.lowercased().contains("not"))
    }

    func testDeniedStateStatesProtectionIsNotActive() {
        let copy = AntiRemovalClaimCopy.current(for: .denied)
        XCTAssertEqual(copy.statusHeadline, "Not active")
    }

    func testRevokedStateIsSurfacedRatherThanSilentlyReportingStaleProtection() {
        // Mirrors doc 07 Section 14's "authorization revoked ... surfaced
        // as an out-of-band change rather than silently reporting stale
        // 'protected' status" -- the copy layer must not collapse
        // `.revoked` into looking like `.approved`.
        let revokedCopy = AntiRemovalClaimCopy.current(for: .revoked(to: .denied))
        let approvedCopy = AntiRemovalClaimCopy.current(for: .approved)
        XCTAssertNotEqual(revokedCopy.statusHeadline, approvedCopy.statusHeadline)
        XCTAssertTrue(revokedCopy.statusDetail.lowercased().contains("off") || revokedCopy.statusDetail.lowercased().contains("changed"))
    }

    func testEntitlementUnavailableIsDistinctFromDenied() {
        // doc 07 Section 11 / ChildAuthorizationState doc comment:
        // entitlement unavailability is a distinct honest state from an
        // ordinary parent decline, and the copy must not conflate them.
        let unavailable = AntiRemovalClaimCopy.current(for: .entitlementUnavailable)
        let denied = AntiRemovalClaimCopy.current(for: .denied)
        XCTAssertNotEqual(unavailable.statusHeadline, denied.statusHeadline)
        XCTAssertNotEqual(unavailable.statusDetail, denied.statusDetail)
    }

    func testNoStatusDetailAssertsAnUnqualifiedCannotBeRemovedClaim() {
        // The precise phrase PCA-IOS-002 forbids appearing without
        // qualification is "cannot be removed from the device." No
        // per-state detail line may contain that phrase on its own --
        // only the fixed, always-present scopeQualifier is allowed to
        // discuss removability in absolute terms, and only to disclaim it.
        for state in allStates {
            let copy = AntiRemovalClaimCopy.current(for: state)
            XCTAssertFalse(copy.statusDetail.lowercased().contains("cannot be removed from the device"), "state \(state) must not assert an unqualified removal claim")
            XCTAssertFalse(copy.statusDetail.lowercased().contains("cannot be uninstalled"), "state \(state) must not assert an unqualified uninstall claim")
        }
    }
}
