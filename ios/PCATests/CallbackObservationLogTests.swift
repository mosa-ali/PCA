import XCTest
@testable import PCA

/// PCA-15 correction F1, requirements 4-6. Exercised against
/// Bounded recording plus host-side UserDefaults serialization tests. These
/// tests do not establish real App Group cross-process or device delivery.
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
        let expected = [ExpectedCallback(kind: .intervalDidStart, occurrenceAt: now)]
        let health = DeviceActivityCallbackReconciler.reconcile(expected: expected, observed: observed, activityId: "activity-1", installationGeneration: "current", nowUtc: now.addingTimeInterval(500))
        XCTAssertEqual(health, .unknown, "legacy observations without installation evidence cannot certify health")
    }

    func testReplayedEventThresholdCallbackWithSameEventIdIsIdempotentForReconciliation() {
        let log = InMemoryCallbackObservationLog()
        let now = Date(timeIntervalSince1970: 1_700_000_000)
        log.record(kind: .eventDidReachThreshold(eventId: "limit-30"), activityId: "activity-1", at: now)
        log.record(kind: .eventDidReachThreshold(eventId: "limit-30"), activityId: "activity-1", at: now.addingTimeInterval(1))
        log.record(kind: .eventDidReachThreshold(eventId: "limit-30"), activityId: "activity-1", at: now.addingTimeInterval(2))

        let observed = log.readAll().map(\.asObservedCallback)
        let expected = [ExpectedCallback(kind: .eventDidReachThreshold(eventId: "limit-30"), occurrenceAt: now)]
        let firstReconcile = DeviceActivityCallbackReconciler.reconcile(expected: expected, observed: observed, activityId: "activity-1", installationGeneration: "current", nowUtc: now.addingTimeInterval(500))
        let secondReconcile = DeviceActivityCallbackReconciler.reconcile(expected: expected, observed: observed, activityId: "activity-1", installationGeneration: "current", nowUtc: now.addingTimeInterval(500))
        XCTAssertEqual(firstReconcile, secondReconcile, "reconciling the same observation set twice must be deterministic")
        XCTAssertEqual(firstReconcile, .unknown)
    }

    func testMultipleActivitiesAreDistinguishableInThePersistedLog() {
        let log = InMemoryCallbackObservationLog()
        let now = Date(timeIntervalSince1970: 1_700_000_000)
        log.record(kind: .intervalDidStart, activityId: "activity-a", at: now)
        log.record(kind: .intervalDidStart, activityId: "activity-b", at: now)

        let activityIds = Set(log.readAll().map(\.activityId))
        XCTAssertEqual(activityIds, ["activity-a", "activity-b"])
    }

    func testSharedLogTagsOnlyMatchingInstallationAndRetainsIdentity() throws {
        let suite = "org.pca.tests.callback.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let now = Date(timeIntervalSince1970: 1_700_000_000)
        let monitor = "pca-monitor-11111111-1111-4111-8111-111111111111"
        let generation = "22222222-2222-4222-8222-222222222222"
        let installation = DeviceActivityMonitorInstallation(
            policyActivityId: "policy", monitorActivityId: monitor, generation: generation,
            installedAtUtc: now, timeZoneIdentifier: "UTC", state: .starting
        )
        defaults.set(try JSONEncoder().encode(installation), forKey: deviceActivityMonitorInstallationStorageKey)
        let log = try AppGroupCallbackObservationLog(appGroupIdentifier: suite)
        log.record(kind: .intervalDidStart, activityId: monitor, at: now)
        log.record(kind: .intervalDidStart, activityId: "monitor-old", at: now)
        let records = log.readAll()
        XCTAssertEqual(records.first?.installationGeneration, generation)
        XCTAssertNil(records.last?.installationGeneration)
        XCTAssertEqual(records.first?.asObservedCallback.activityId, monitor)
        XCTAssertEqual(records.first?.asObservedCallback.installationGeneration, generation)
        defaults.set(try JSONEncoder().encode(installation.confirmingActive()), forKey: deviceActivityMonitorInstallationStorageKey)
        XCTAssertEqual(DeviceActivityCallbackReconciler.reconcile(
            expected: [ExpectedCallback(kind: .intervalDidStart, occurrenceAt: now, observationWindowEndsAt: now.addingTimeInterval(86400), attributionIsUnambiguous: true)],
            observed: records.map(\.asObservedCallback), activityId: monitor,
            installationGeneration: generation, nowUtc: now.addingTimeInterval(180)
        ), .healthy, "an immediate callback recorded during start remains eligible after success")

        defaults.set(Data("corrupt".utf8), forKey: deviceActivityMonitorInstallationStorageKey)
        log.record(kind: .intervalDidStart, activityId: monitor, at: now)
        XCTAssertNil(log.readAll().last?.installationGeneration)
    }

    func testLegacyObservationDecodesWithoutGeneration() throws {
        let record = PersistedCallbackObservation(kind: .intervalDidStart, activityId: "legacy", observedAtUtc: Date(timeIntervalSince1970: 0), sequence: 1)
        var json = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(record)) as? [String: Any])
        json.removeValue(forKey: "installationGeneration")
        let decoded = try JSONDecoder().decode(PersistedCallbackObservation.self, from: JSONSerialization.data(withJSONObject: json))
        XCTAssertEqual(decoded.activityId, "legacy")
        XCTAssertNil(decoded.installationGeneration)
    }
}
