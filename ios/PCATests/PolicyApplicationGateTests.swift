import XCTest
@testable import PCA

final class PolicyApplicationGateTests: XCTestCase {
    func testGenesisFloorAcceptsAnyStamp() {
        let candidate = PolicyEpochStamp(trustSetEpoch: 5, keyEpoch: 3)
        XCTAssertEqual(PolicyApplicationGate.evaluate(candidate: candidate, currentFloor: nil), .apply)
    }

    func testEqualEpochsAreAccepted() {
        let floor = PolicyEpochStamp(trustSetEpoch: 2, keyEpoch: 2)
        XCTAssertEqual(PolicyApplicationGate.evaluate(candidate: floor, currentFloor: floor), .apply)
    }

    func testHigherEpochsAreAccepted() {
        let floor = PolicyEpochStamp(trustSetEpoch: 2, keyEpoch: 2)
        let candidate = PolicyEpochStamp(trustSetEpoch: 3, keyEpoch: 3)
        XCTAssertEqual(PolicyApplicationGate.evaluate(candidate: candidate, currentFloor: floor), .apply)
    }

    func testStaleTrustSetEpochIsRejectedIndependentlyOfKeyEpoch() {
        let floor = PolicyEpochStamp(trustSetEpoch: 5, keyEpoch: 1)
        let candidate = PolicyEpochStamp(trustSetEpoch: 4, keyEpoch: 10) // keyEpoch higher, trustSetEpoch lower
        XCTAssertEqual(PolicyApplicationGate.evaluate(candidate: candidate, currentFloor: floor), .rejectStaleTrustSetEpoch)
    }

    func testStaleKeyEpochIsRejectedIndependentlyOfTrustSetEpoch() {
        let floor = PolicyEpochStamp(trustSetEpoch: 1, keyEpoch: 5)
        let candidate = PolicyEpochStamp(trustSetEpoch: 10, keyEpoch: 4) // trustSetEpoch higher, keyEpoch lower
        XCTAssertEqual(PolicyApplicationGate.evaluate(candidate: candidate, currentFloor: floor), .rejectStaleKeyEpoch)
    }

    func testReplayOfAnAlreadyAcceptedStampIsAcceptedNotRejected() {
        // Idempotent redelivery of the exact current floor is not a
        // downgrade -- must not be rejected as stale.
        let floor = PolicyEpochStamp(trustSetEpoch: 3, keyEpoch: 3)
        XCTAssertEqual(PolicyApplicationGate.evaluate(candidate: floor, currentFloor: floor), .apply)
    }
}
