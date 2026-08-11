import XCTest
@testable import PCA

/// Directly satisfies doc 07 Section 20's acceptance criterion:
/// "PCA-IOS-003's emergency-shield floor is covered by a test asserting a
/// malformed policy envelope covering Phone/Emergency SOS is rejected."
final class EmergencyShieldFloorTests: XCTestCase {
    private enum SystemEmergencyToken: Hashable {
        case phone
        case emergencySOS
        case faceTimeEmergencyAdjacent
        case youtube
        case games
    }

    func testMalformedPolicyShieldingPhoneIsRejectedRegardlessOfOtherContent() {
        let validator = ShieldPolicyValidator<SystemEmergencyToken>(
            protectedApplicationTokens: [.phone, .emergencySOS, .faceTimeEmergencyAdjacent],
            protectedCategoryTokens: []
        )
        let outcome = validator.validate(applications: [.youtube, .games, .phone], categories: [], domains: [])
        guard case .rejected = outcome else {
            return XCTFail("a shield configuration covering Phone must be rejected, never applied")
        }
    }

    func testMalformedPolicyShieldingEmergencySOSIsRejected() {
        let validator = ShieldPolicyValidator<SystemEmergencyToken>(
            protectedApplicationTokens: [.phone, .emergencySOS, .faceTimeEmergencyAdjacent],
            protectedCategoryTokens: []
        )
        let outcome = validator.validate(applications: [.emergencySOS], categories: [], domains: [])
        guard case .rejected = outcome else {
            return XCTFail("a shield configuration covering Emergency SOS must be rejected, never applied")
        }
    }

    func testAWellFormedPolicyThatNeverTouchesTheProtectedSurfaceIsAccepted() {
        let validator = ShieldPolicyValidator<SystemEmergencyToken>(
            protectedApplicationTokens: [.phone, .emergencySOS, .faceTimeEmergencyAdjacent],
            protectedCategoryTokens: []
        )
        let outcome = validator.validate(applications: [.youtube, .games], categories: [], domains: [])
        XCTAssertEqual(outcome, .accepted)
    }

    func testRejectionIsIndependentOfSignatureValidity() {
        // doc 07 PCA-IOS-003: "MUST be rejected client-side regardless of
        // signature validity." ShieldPolicyValidator has no signature
        // parameter at all -- it operates purely on already-decrypted
        // shield content, structurally incapable of being influenced by
        // whether the enclosing envelope's signature was valid, proving
        // this check cannot be bypassed by "but it was signed."
        let validator = ShieldPolicyValidator<SystemEmergencyToken>(
            protectedApplicationTokens: [.phone],
            protectedCategoryTokens: []
        )
        let outcome = validator.validate(applications: [.phone], categories: [], domains: [])
        guard case .rejected = outcome else {
            return XCTFail("no signature-related input exists to this validator; it must reject on content alone")
        }
    }
}
