import XCTest
@testable import PCA

final class ShieldSafetyValidatorTests: XCTestCase {
    func testSafeWhenNoOverlapWithProtectedTokens() {
        let validator = ShieldSafetyValidator<String>(protectedTokens: ["phone", "emergency-sos"])
        XCTAssertEqual(validator.validate(candidateTokens: ["youtube", "games"]), .safe)
    }

    func testRejectedWhenCandidateIncludesAProtectedToken() {
        let validator = ShieldSafetyValidator<String>(protectedTokens: ["phone", "emergency-sos"])
        let result = validator.validate(candidateTokens: ["youtube", "phone"])
        XCTAssertEqual(result, .rejected(overlappingCount: 1))
    }

    func testRejectedCountsEveryOverlappingProtectedToken() {
        let validator = ShieldSafetyValidator<String>(protectedTokens: ["phone", "emergency-sos", "facetime-emergency"])
        let result = validator.validate(candidateTokens: ["phone", "emergency-sos", "games"])
        XCTAssertEqual(result, .rejected(overlappingCount: 2))
    }

    func testEmptyProtectedSetNeverRejects() {
        let validator = ShieldSafetyValidator<String>(protectedTokens: [])
        XCTAssertEqual(validator.validate(candidateTokens: ["anything"]), .safe)
    }

    // MARK: - Token opacity: equality only, never any string/identity extraction.

    func testValidatorNeverInspectsTokenIdentityBeyondEquality() {
        // OpaqueMarkerToken deliberately exposes NOTHING but Hashable/Equatable --
        // if ShieldSafetyValidator compiled and behaved correctly against it,
        // that is itself proof the validator performs no reverse-lookup/
        // string-extraction operation on tokens.
        struct OpaqueMarkerToken: Hashable {
            let opaqueId: UUID
        }
        let protectedToken = OpaqueMarkerToken(opaqueId: UUID())
        let otherToken = OpaqueMarkerToken(opaqueId: UUID())
        let validator = ShieldSafetyValidator<OpaqueMarkerToken>(protectedTokens: [protectedToken])

        XCTAssertEqual(validator.validate(candidateTokens: [otherToken]), .safe)
        XCTAssertEqual(validator.validate(candidateTokens: [protectedToken]), .rejected(overlappingCount: 1))
    }

    // MARK: - Policy-level aggregate (applications + categories + domains independently checked)

    func testShieldPolicyValidatorAcceptsWhenAllThreeDimensionsAreSafe() {
        let validator = ShieldPolicyValidator<String>(
            protectedApplicationTokens: ["phone"],
            protectedCategoryTokens: ["emergency-category"],
            protectedDomainTokens: []
        )
        let outcome = validator.validate(applications: ["youtube"], categories: ["games"], domains: ["example.com"])
        XCTAssertEqual(outcome, .accepted)
    }

    func testShieldPolicyValidatorRejectsWhenApplicationsDimensionUnsafe() {
        let validator = ShieldPolicyValidator<String>(protectedApplicationTokens: ["phone"], protectedCategoryTokens: [])
        let outcome = validator.validate(applications: ["phone"], categories: [], domains: [])
        guard case .rejected(let reasons) = outcome else {
            return XCTFail("expected rejection")
        }
        XCTAssertEqual(reasons.count, 1)
    }

    func testShieldPolicyValidatorRejectsWhenCategoriesDimensionUnsafeEvenIfApplicationsAreSafe() {
        let validator = ShieldPolicyValidator<String>(protectedApplicationTokens: [], protectedCategoryTokens: ["emergency-category"])
        let outcome = validator.validate(applications: ["youtube"], categories: ["emergency-category"], domains: [])
        guard case .rejected = outcome else {
            return XCTFail("expected rejection -- category dimension must be checked independently of applications")
        }
    }

    func testShieldPolicyValidatorAccumulatesReasonsAcrossMultipleUnsafeDimensions() {
        let validator = ShieldPolicyValidator<String>(protectedApplicationTokens: ["phone"], protectedCategoryTokens: ["emergency-category"])
        let outcome = validator.validate(applications: ["phone"], categories: ["emergency-category"], domains: [])
        guard case .rejected(let reasons) = outcome else {
            return XCTFail("expected rejection")
        }
        XCTAssertEqual(reasons.count, 2, "both unsafe dimensions must be reported, not just the first one found")
    }
}
