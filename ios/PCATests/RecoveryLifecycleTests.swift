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

    func testLifecycleIdentifiersAndReasonUseCrossPlatformBlankAndLengthRules() throws {
        let sink = InMemoryEnrollmentLifecycleAuditSink()
        XCTAssertThrowsError(try EnrollmentLifecycleMachine(
            familyId: " \t\n", deviceId: "device-1", auditSink: sink
        )) {
            XCTAssertEqual($0 as? EnrollmentLifecycleTransitionError, .missingOpaqueIdentifier)
        }

        let machine = try EnrollmentLifecycleMachine(familyId: "family-1", deviceId: "device-1", auditSink: sink)
        XCTAssertThrowsError(try machine.transition(to: .invited, actorId: " \t", reason: "valid")) {
            XCTAssertEqual($0 as? EnrollmentLifecycleTransitionError, .missingOpaqueIdentifier)
        }
        for reason in [" \t\n", String(repeating: "😀", count: 141)] {
            XCTAssertThrowsError(try machine.transition(to: .invited, actorId: "parent-1", reason: reason)) {
                XCTAssertEqual($0 as? EnrollmentLifecycleTransitionError, .invalidReason)
            }
        }

        let exactly280Utf16Units = String(repeating: "😀", count: 140)
        XCTAssertNoThrow(try machine.transition(to: .invited, actorId: "parent-1", reason: exactly280Utf16Units))
        XCTAssertEqual(machine.state, .invited)
        XCTAssertEqual(sink.records.count, 1)
    }

    func testUnicodeWhiteSpaceBlankSetMatchesSharedLifecycleVectors() throws {
        let whitespaceScalars: [UInt32] = [
            0x0009, 0x000A, 0x000B, 0x000C, 0x000D, 0x0020, 0x0085, 0x00A0, 0x1680,
            0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008,
            0x2009, 0x200A, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000,
        ]
        for codePoint in whitespaceScalars {
            let blank = String(UnicodeScalar(codePoint)!)
            XCTAssertThrowsError(try EnrollmentLifecycleMachine(
                familyId: blank, deviceId: "device-1", auditSink: InMemoryEnrollmentLifecycleAuditSink()
            ), "U+\(String(codePoint, radix: 16)) must be blank as a family id") {
                XCTAssertEqual($0 as? EnrollmentLifecycleTransitionError, .missingOpaqueIdentifier)
            }
            XCTAssertThrowsError(try EnrollmentLifecycleMachine(
                familyId: "family-1", deviceId: blank, auditSink: InMemoryEnrollmentLifecycleAuditSink()
            ), "U+\(String(codePoint, radix: 16)) must be blank as a device id") {
                XCTAssertEqual($0 as? EnrollmentLifecycleTransitionError, .missingOpaqueIdentifier)
            }

            let sink = InMemoryEnrollmentLifecycleAuditSink()
            let machine = try EnrollmentLifecycleMachine(familyId: "family-1", deviceId: "device-1", auditSink: sink)
            XCTAssertThrowsError(try machine.transition(to: .invited, actorId: blank, reason: "valid"),
                "U+\(String(codePoint, radix: 16)) must be blank as an actor id") {
                XCTAssertEqual($0 as? EnrollmentLifecycleTransitionError, .missingOpaqueIdentifier)
            }
            XCTAssertThrowsError(try machine.transition(to: .invited, actorId: "parent-1", reason: blank),
                "U+\(String(codePoint, radix: 16)) must be blank as a reason") {
                XCTAssertEqual($0 as? EnrollmentLifecycleTransitionError, .invalidReason)
            }
            XCTAssertEqual(machine.state, .new)
            XCTAssertTrue(sink.records.isEmpty)
        }
    }

    func testUnicodeControlSeparatorsAndBomAreNotInSharedBlankSet() throws {
        let nonblankScalars: [UInt32] = [0x001C, 0x001D, 0x001E, 0x001F, 0xFEFF]
        for codePoint in nonblankScalars {
            let value = String(UnicodeScalar(codePoint)!)
            let sink = InMemoryEnrollmentLifecycleAuditSink()
            let machine = try EnrollmentLifecycleMachine(familyId: value, deviceId: value, auditSink: sink)
            let record = try machine.transition(to: .invited, actorId: value, reason: value)
            XCTAssertEqual(record.familyId, value)
            XCTAssertEqual(record.deviceId, value)
            XCTAssertEqual(record.actorId, value)
            XCTAssertEqual(record.reason, value)
            XCTAssertEqual(machine.state, .invited)
            XCTAssertEqual(sink.records.count, 1)
        }
    }
}
