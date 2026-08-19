import XCTest
@testable import PCA

final class RecoverySecretDisclosureTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_700_000_000)

    func testGenerationRequiresDisclosureAcknowledgement() throws {
        let gate = RecoverySecretGenerationGate(now: { self.now })
        XCTAssertThrowsError(try gate.completeGeneration()) { error in
            XCTAssertEqual(error as? RecoverySecretGenerationError, .disclosureNotPresented)
        }

        let disclosure = gate.presentDisclosure()
        XCTAssertTrue(disclosure.acknowledgementRequired)
        XCTAssertTrue(disclosure.body.contains("permanently impossible"))
        XCTAssertTrue(disclosure.body.contains("support cannot recover"))

        XCTAssertThrowsError(try gate.completeGeneration()) { error in
            XCTAssertEqual(error as? RecoverySecretGenerationError, .disclosureNotAcknowledged)
        }
        try gate.acknowledgeDisclosure()
        let receipt = try gate.completeGeneration()
        XCTAssertEqual(receipt.disclosureAcknowledgedAtUtc, now)
        XCTAssertEqual(receipt.generatedAtUtc, now)
    }

    func testDisclosureGateNeverAcceptsOrReturnsSecretMaterial() throws {
        let gate = RecoverySecretGenerationGate(now: { self.now })
        _ = gate.presentDisclosure()
        try gate.acknowledgeDisclosure()
        _ = try gate.completeGeneration()
        XCTAssertTrue(gate.generationCompleted)
    }
}
