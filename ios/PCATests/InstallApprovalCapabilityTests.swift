import XCTest
@testable import PCA

/// PCA-FR-131 (CAPABILITY_HONEST_INSTALL_APPROVAL): iOS's install-approval capability is
/// categorically `.notSupported` — see `InstallApprovalCapability.swift`'s own doc comment for
/// exactly why (no Family Controls/ManagedSettings/DeviceActivity API observes a new install).
/// This is the "unsupported platform reports an honest state, not a fabricated pass" coverage.
///
/// NOTE: per `ios/README.md`, this workspace has no Xcode/iOS SDK available to actually run
/// `xcodebuild test` — this file is written to the SAME protocol-seam/mirror-enum discipline every
/// other PCA-15 test file already follows so it is unit-testable on any platform once it IS run on
/// a Mac (see `docs/MAC_XCODE_VALIDATION_CHECKLIST.md` Section 2), but running it is not claimed
/// here.
final class InstallApprovalCapabilityTests: XCTestCase {
    func testResolverReportsNotSupportedCategorically() {
        XCTAssertEqual(InstallApprovalCapabilityResolver.resolve(), .notSupported)
    }

    func testRawValuesMatchTheSharedCrossPlatformVocabularyVerbatim() {
        XCTAssertEqual(InstallApprovalCapability.enforced.rawValue, "ENFORCED")
        XCTAssertEqual(InstallApprovalCapability.requestOnly.rawValue, "REQUEST_ONLY")
        XCTAssertEqual(InstallApprovalCapability.authorizationRequired.rawValue, "AUTHORIZATION_REQUIRED")
        XCTAssertEqual(InstallApprovalCapability.notSupported.rawValue, "NOT_SUPPORTED")
        XCTAssertEqual(InstallApprovalCapability.platformLimited.rawValue, "PLATFORM_LIMITED")
    }

    func testNeverReportsEnforcedOrRequestOnly() {
        // The install-approval "request/notify" half also has no home on iOS: there is no signal
        // to build a request FROM in the first place (see the resolver's own doc comment) --
        // capability must never be upgraded to look more real than it is.
        let capability = InstallApprovalCapabilityResolver.resolve()
        XCTAssertNotEqual(capability, .enforced)
        XCTAssertNotEqual(capability, .requestOnly)
        XCTAssertNotEqual(capability, .authorizationRequired)
        XCTAssertNotEqual(capability, .platformLimited)
    }
}
