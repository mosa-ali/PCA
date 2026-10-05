import XCTest
@testable import PCA

final class PolicyApplicationGateTests: XCTestCase {
    func testMissingTrustedFloorFailsClosed() {
        let candidate = PolicyEpochStamp(trustSetEpoch: 5, keyEpoch: 3)
        XCTAssertEqual(PolicyApplicationGate.evaluate(candidate: candidate, currentFloor: nil), .rejectMissingTrustedEpochFloor)
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

    func testInt32MaximumEpochsAreAccepted() {
        let maximum = PolicyApplicationGate.maximumEpoch
        let stamp = PolicyEpochStamp(trustSetEpoch: maximum, keyEpoch: maximum)

        XCTAssertEqual(PolicyApplicationGate.evaluate(candidate: stamp, currentFloor: stamp), .apply)
    }

    func testCandidateAboveInt32MaximumIsRejected() {
        let maximum = PolicyApplicationGate.maximumEpoch
        let floor = PolicyEpochStamp(trustSetEpoch: 1, keyEpoch: 0)

        XCTAssertEqual(
            PolicyApplicationGate.evaluate(
                candidate: PolicyEpochStamp(trustSetEpoch: maximum + 1, keyEpoch: 0),
                currentFloor: floor
            ),
            .rejectInvalidCandidateEpoch
        )
        XCTAssertEqual(
            PolicyApplicationGate.evaluate(
                candidate: PolicyEpochStamp(trustSetEpoch: 1, keyEpoch: maximum + 1),
                currentFloor: floor
            ),
            .rejectInvalidCandidateEpoch
        )
    }

    func testPersistedFloorAboveInt32MaximumIsRejected() {
        let maximum = PolicyApplicationGate.maximumEpoch

        XCTAssertEqual(
            PolicyApplicationGate.evaluate(
                candidate: PolicyEpochStamp(trustSetEpoch: maximum, keyEpoch: 1),
                currentFloor: PolicyEpochStamp(trustSetEpoch: maximum + 1, keyEpoch: 1)
            ),
            .rejectInvalidTrustedEpochFloor
        )
        XCTAssertEqual(
            PolicyApplicationGate.evaluate(
                candidate: PolicyEpochStamp(trustSetEpoch: 1, keyEpoch: maximum),
                currentFloor: PolicyEpochStamp(trustSetEpoch: 1, keyEpoch: maximum + 1)
            ),
            .rejectInvalidTrustedEpochFloor
        )
    }

    func testNegativeCandidateEpochsAreRejectedButZeroKeyEpochRemainsValid() {
        let zeroKeyFloor = PolicyEpochStamp(trustSetEpoch: 1, keyEpoch: 0)

        XCTAssertEqual(
            PolicyApplicationGate.evaluate(
                candidate: PolicyEpochStamp(trustSetEpoch: -1, keyEpoch: 0),
                currentFloor: zeroKeyFloor
            ),
            .rejectInvalidCandidateEpoch
        )
        XCTAssertEqual(
            PolicyApplicationGate.evaluate(
                candidate: PolicyEpochStamp(trustSetEpoch: 0, keyEpoch: 0),
                currentFloor: zeroKeyFloor
            ),
            .rejectInvalidCandidateEpoch
        )
        XCTAssertEqual(
            PolicyApplicationGate.evaluate(
                candidate: PolicyEpochStamp(trustSetEpoch: 1, keyEpoch: -1),
                currentFloor: zeroKeyFloor
            ),
            .rejectInvalidCandidateEpoch
        )
        XCTAssertEqual(PolicyApplicationGate.evaluate(candidate: zeroKeyFloor, currentFloor: zeroKeyFloor), .apply)
    }

    func testInvalidPersistedFloorIsRejectedIncludingNegativeAndZeroTrustSetEpoch() {
        let candidate = PolicyEpochStamp(trustSetEpoch: 2, keyEpoch: 0)

        XCTAssertEqual(
            PolicyApplicationGate.evaluate(
                candidate: candidate,
                currentFloor: PolicyEpochStamp(trustSetEpoch: 0, keyEpoch: 0)
            ),
            .rejectInvalidTrustedEpochFloor
        )
        XCTAssertEqual(
            PolicyApplicationGate.evaluate(
                candidate: candidate,
                currentFloor: PolicyEpochStamp(trustSetEpoch: 1, keyEpoch: -1)
            ),
            .rejectInvalidTrustedEpochFloor
        )
    }
}
