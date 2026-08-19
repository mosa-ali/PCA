import XCTest
@testable import PCA

final class RecoveryLifecycleTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_700_000_000)

    func testEveryDocumentedLifecycleTransitionRecordsActorTimeAndReason() throws {
        let sink = InMemoryEnrollmentLifecycleAuditSink()
        let machine = try EnrollmentLifecycleMachine(
            familyId: "family-1",
            deviceId: "device-1",
            auditSink: sink,
            now: { self.now }
        )

        let transitions: [(EnrollmentLifecycleState, EnrollmentLifecycleState)] = [
            (.new, .invited), (.invited, .paired), (.paired, .active),
            (.active, .degraded), (.degraded, .active),
            (.active, .recoveryPending), (.recoveryPending, .active),
            (.active, .revoked), (.revoked, .removed), (.removed, .new),
            (.new, .invited), (.invited, .revoked), (.revoked, .removed),
            (.removed, .new), (.new, .invited), (.invited, .paired),
            (.paired, .active), (.active, .degraded), (.degraded, .recoveryPending),
            (.recoveryPending, .active), (.active, .revoked), (.revoked, .removed)
        ]

        for (from, to) in transitions {
            XCTAssertEqual(machine.state, from)
            let record = try machine.transition(to: to, actorId: "parent-device-1", reason: "test transition")
            XCTAssertEqual(record.fromState, from)
            XCTAssertEqual(record.toState, to)
            XCTAssertEqual(record.actorId, "parent-device-1")
            XCTAssertEqual(record.occurredAtUtc, now)
        }
        XCTAssertEqual(sink.records.count, transitions.count)
    }

    func testInvalidTransitionDoesNotChangeStateOrAuditLog() throws {
        let sink = InMemoryEnrollmentLifecycleAuditSink()
        let machine = try EnrollmentLifecycleMachine(familyId: "family-1", deviceId: "device-1", auditSink: sink)

        XCTAssertThrowsError(try machine.transition(to: .active, actorId: "parent-device-1", reason: "skip pairing")) { error in
            XCTAssertEqual(error as? EnrollmentLifecycleTransitionError, .invalidTransition(from: .new, to: .active))
        }
        XCTAssertEqual(machine.state, .new)
        XCTAssertTrue(sink.records.isEmpty)
    }
}
