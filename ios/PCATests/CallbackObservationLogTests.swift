import XCTest
@testable import PCA

/// PCA-15 correction F1, requirements 4-6. Exercised against
/// `InMemoryCallbackObservationLog`, which implements the EXACT SAME
/// record/readAll/bounded-eviction logic `AppGroupCallbackObservationLog`
/// does -- the only difference is the backing store (UserDefaults(suiteName:)
/// vs. an in-memory dictionary), which requires a real App Group / Xcode
/// environment to exercise (see docs/MAC_XCODE_VALIDATION_CHECKLIST.md).
final class CallbackObservationLogTests: XCTestCase {
    // MARK: 4. record() actually persists / 5. persisted observation can be read back.

    func testRecordedObservationIsReadableAfterward() {
        let log = InMemoryCallbackObservationLog()
        let now = Date(timeIntervalSince1970: 1_700_000_000)
        log.record(kind: .intervalDidStart, activityId: "activity-1", at: now)

        let all = log.readAll()
        XCTAssertEqual(all.count, 1)
        XCTAssertEqual(all.first?.kind, .intervalDidStart)
        XCTAssertEqual(all.first?.activityId, "activity-1")
        XCTAssertEqual(all.first?.observedAtUtc, now)
    }

    func testSequenceNumbersAreMonotonicallyIncreasing() {
        let log = InMemoryCallbackObservationLog()
        let now = Date(timeIntervalSince1970: 1_700_000_000)
        log.record(kind: .intervalDidStart, activityId: "a", at: now)
        log.record(kind: .intervalDidEnd, activityId: "a", at: now.addingTimeInterval(60))
        log.record(kind: .eventDidReachThreshold(eventId: "limit-30"), activityId: "a", at: now.addingTimeInterval(120))

        let sequences = log.readAll().map(\.sequence)
        XCTAssertEqual(sequences, sequences.sorted())
        XCTAssertEqual(Set(sequences).count, sequences.count, "sequence numbers must be unique")
    }

    func testBoundedCapacityEvictsOldestFirst() {
        let log = InMemoryCallbackObservationLog(capacity: 3)
        let now = Date(timeIntervalSince1970: 1_700_000_000)
        for i in 0..<5 {
            log.record(kind: .intervalDidStart, activityId: "activity-\(i)", at: now.addingTimeInterval(Double(i)))
        }
        let all = log.readAll()
        XCTAssertEqual(all.count, 3)
        XCTAssertEqual(all.map(\.activityId), ["activity-2", "activity-3", "activity-4"], "oldest entries must be evicted first")
    }

    func testReadAllOnEmptyLogReturnsEmptyArray() {
        let log = InMemoryCallbackObservationLog()
        XCTAssertEqual(log.readAll(), [])
    }

    // MARK: 6. Duplicate/replayed callback handling remains deterministic.

    func testDuplicateCallbacksAreBothPersistedButReconciliationStaysDeterministic() {
        let log = InMemoryCallbackObservationLog()
        let now = Date(timeIntervalSince1970: 1_700_000_000)
        // The OS (or a host-app crash-and-retry) redelivers/re-records the
        // SAME callback kind twice.
        log.record(kind: .intervalDidStart, activityId: "activity-1", at: now)
        log.record(kind: .intervalDidStart, activityId: "activity-1", at: now.addingTimeInterval(1))

        XCTAssertEqual(log.readAll().count, 2, "duplicates are not silently collapsed at the storage layer")

        let observed = log.readAll().map(\.asObservedCallback)
        let expected = [ExpectedCallback(kind: .intervalDidStart, expectedNoLaterThan: now)]
        let health = DeviceActivityCallbackReconciler.reconcile(expected: expected, observed: observed, nowUtc: now.addingTimeInterval(500))
        XCTAssertEqual(health, .healthy, "reconciliation is a Set-membership test over kinds, so any number of duplicates converges to the same verdict")
    }

    func testReplayedEventThresholdCallbackWithSameEventIdIsIdempotentForReconciliation() {
        let log = InMemoryCallbackObservationLog()
        let now = Date(timeIntervalSince1970: 1_700_000_000)
        log.record(kind: .eventDidReachThreshold(eventId: "limit-30"), activityId: "activity-1", at: now)
        log.record(kind: .eventDidReachThreshold(eventId: "limit-30"), activityId: "activity-1", at: now.addingTimeInterval(1))
        log.record(kind: .eventDidReachThreshold(eventId: "limit-30"), activityId: "activity-1", at: now.addingTimeInterval(2))

        let observed = log.readAll().map(\.asObservedCallback)
        let expected = [ExpectedCallback(kind: .eventDidReachThreshold(eventId: "limit-30"), expectedNoLaterThan: now)]
        let firstReconcile = DeviceActivityCallbackReconciler.reconcile(expected: expected, observed: observed, nowUtc: now.addingTimeInterval(500))
        let secondReconcile = DeviceActivityCallbackReconciler.reconcile(expected: expected, observed: observed, nowUtc: now.addingTimeInterval(500))
        XCTAssertEqual(firstReconcile, secondReconcile, "reconciling the same observation set twice must be deterministic")
        XCTAssertEqual(firstReconcile, .healthy)
    }

    func testMultipleActivitiesAreDistinguishableInThePersistedLog() {
        let log = InMemoryCallbackObservationLog()
        let now = Date(timeIntervalSince1970: 1_700_000_000)
        log.record(kind: .intervalDidStart, activityId: "activity-a", at: now)
        log.record(kind: .intervalDidStart, activityId: "activity-b", at: now)

        let activityIds = Set(log.readAll().map(\.activityId))
        XCTAssertEqual(activityIds, ["activity-a", "activity-b"])
    }
}
