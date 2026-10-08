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
        XCTAssertEqual(records.count, 1)
        let diagnosticData = try XCTUnwrap(defaults.data(forKey: "com.pca.app.deviceactivity.callbacklog.boundaries"))
        let diagnostic = try JSONDecoder().decode([PersistedCallbackObservation].self, from: diagnosticData)
        XCTAssertNil(diagnostic.last?.installationGeneration)
        XCTAssertEqual(records.first?.asObservedCallback.activityId, monitor)
        XCTAssertEqual(records.first?.asObservedCallback.installationGeneration, generation)
        defaults.set(try JSONEncoder().encode(installation.confirmingActive()), forKey: deviceActivityMonitorInstallationStorageKey)
        XCTAssertEqual(DeviceActivityCallbackReconciler.reconcile(
            expected: [ExpectedCallback(kind: .intervalDidStart, occurrenceAt: now, observationWindowEndsAt: now.addingTimeInterval(86400), attributionIsUnambiguous: true)],
            observed: records.map(\.asObservedCallback), activityId: monitor,
            installationGeneration: generation, nowUtc: now.addingTimeInterval(180)
        ), .healthy, "an immediate callback recorded during start remains eligible after success")

        let healthRecordsBeforeCorruptCallback = log.readAll()
        defaults.set(Data("corrupt".utf8), forKey: deviceActivityMonitorInstallationStorageKey)
        log.record(kind: .intervalDidStart, activityId: monitor, at: now)
        XCTAssertEqual(log.readAll(), healthRecordsBeforeCorruptCallback)
        let corruptDiagnosticData = try XCTUnwrap(defaults.data(forKey: "com.pca.app.deviceactivity.callbacklog.boundaries"))
        let corruptDiagnostic = try JSONDecoder().decode([PersistedCallbackObservation].self, from: corruptDiagnosticData)
        XCTAssertEqual(corruptDiagnostic.last?.activityId, monitor)
        XCTAssertNil(corruptDiagnostic.last?.installationGeneration)
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

final class BoundaryCallbackIsolationTests: XCTestCase {
    func testAuxiliaryFloodCannotEvictAnchorHealthEvidence() throws {
        let suite = "org.pca.tests.boundaries.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let anchor = "pca-monitor-\(UUID().uuidString.lowercased())"
        let auxiliary = "pca-monitor-\(UUID().uuidString.lowercased())"
        let generation = UUID().uuidString.lowercased(), now = Date()
        let installation = DeviceActivityMonitorInstallation(policyActivityId: "policy", monitorActivityId: anchor, generation: generation, installedAtUtc: now, timeZoneIdentifier: "UTC", state: .active, schemaVersion: 2, boundaryMonitors: [.init(activityId: auxiliary, trigger: .recurring(timeZoneIdentifier: "UTC", hour: 22, minute: 0))])
        defaults.set(try JSONEncoder().encode(installation), forKey: deviceActivityMonitorInstallationStorageKey)
        let log = try AppGroupCallbackObservationLog(appGroupIdentifier: suite, capacity: 3)
        log.record(kind: .intervalDidStart, activityId: anchor, at: now)
        for _ in 0..<10 { log.record(kind: .intervalDidStart, activityId: auxiliary, at: now) }
        XCTAssertEqual(log.readAll().count, 1)
        XCTAssertEqual(log.readAll().first?.activityId, anchor)
        let data = try XCTUnwrap(defaults.data(forKey: "com.pca.app.deviceactivity.callbacklog.boundaries"))
        let diagnostics = try JSONDecoder().decode([PersistedCallbackObservation].self, from: data)
        XCTAssertEqual(diagnostics.count, 3)
        XCTAssertTrue(diagnostics.allSatisfy { $0.installationGeneration == generation })
    }
    func testMissingCorruptOrInvalidatedManifestFloodCannotEvictAnchorHealthEvidence() throws {
        for manifestState in ["missing", "corrupt", "invalidated"] {
            let suite = "org.pca.tests.boundaries.\(manifestState).\(UUID().uuidString)"
            let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
            defer { defaults.removePersistentDomain(forName: suite) }
            let anchor = "pca-monitor-\(UUID().uuidString.lowercased())"
            let generation = UUID().uuidString.lowercased()
            let now = Date()
            let active = DeviceActivityMonitorInstallation(
                policyActivityId: "policy", monitorActivityId: anchor, generation: generation,
                installedAtUtc: now, timeZoneIdentifier: "UTC", state: .active
            )
            defaults.set(try JSONEncoder().encode(active), forKey: deviceActivityMonitorInstallationStorageKey)
            let log = try AppGroupCallbackObservationLog(appGroupIdentifier: suite, capacity: 3)
            log.record(kind: .intervalDidStart, activityId: anchor, at: now)
            let anchorEvidence = log.readAll()

            switch manifestState {
            case "missing": defaults.removeObject(forKey: deviceActivityMonitorInstallationStorageKey)
            case "corrupt": defaults.set(Data("corrupt".utf8), forKey: deviceActivityMonitorInstallationStorageKey)
            default: defaults.set(try JSONEncoder().encode(active.invalidating()), forKey: deviceActivityMonitorInstallationStorageKey)
            }
            for offset in 0..<10 {
                log.record(kind: .intervalDidStart, activityId: anchor, at: now.addingTimeInterval(Double(offset + 1)))
            }

            XCTAssertEqual(log.readAll(), anchorEvidence, manifestState)
            let diagnosticData = try XCTUnwrap(defaults.data(forKey: "com.pca.app.deviceactivity.callbacklog.boundaries"))
            let diagnostics = try JSONDecoder().decode([PersistedCallbackObservation].self, from: diagnosticData)
            XCTAssertEqual(diagnostics.count, 3, manifestState)
            XCTAssertTrue(diagnostics.allSatisfy {
                $0.activityId == anchor && $0.installationGeneration == nil
            }, manifestState)
        }
    }
    func testManifestRejectsDuplicateIdsTriggersAndMissingV2Collection() throws {
        let anchor = "pca-monitor-\(UUID().uuidString.lowercased())"
        let generation = UUID().uuidString.lowercased()
        let repeated = DeviceActivityBoundaryMonitor(activityId: anchor, trigger: .recurring(timeZoneIdentifier: "UTC", hour: 1, minute: 0))
        for boundaries: [DeviceActivityBoundaryMonitor]? in [nil, [repeated]] {
            let manifest = DeviceActivityMonitorInstallation(policyActivityId: "policy", monitorActivityId: anchor, generation: generation, installedAtUtc: Date(), timeZoneIdentifier: "UTC", state: .active, schemaVersion: 2, boundaryMonitors: boundaries)
            XCTAssertNil(DeviceActivityMonitorInstallation.decodeValidated(try JSONEncoder().encode(manifest)))
        }
    }
}

#if canImport(Darwin)
final class DeviceActivityFileStorageTests: XCTestCase {
    func testFileOwnershipNeverFallsBackAfterInvalidationOrCorruption() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("pca-policy-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: directory) }
        let legacy = InMemoryBlobStore()
        try legacy.write(Data("old".utf8), forKey: "manifest")
        let store = try AppGroupDeviceActivityFileStore(directory: directory, legacyStore: legacy)
        XCTAssertEqual(store.read(forKey: "manifest"), Data("old".utf8))
        try store.write(Data("new".utf8), forKey: "manifest")
        let restarted = try AppGroupDeviceActivityFileStore(directory: directory, legacyStore: legacy)
        XCTAssertEqual(restarted.read(forKey: "manifest"), Data("new".utf8))
        restarted.remove(forKey: "manifest")
        try legacy.write(Data("tempting-old".utf8), forKey: "manifest")
        XCTAssertNil(restarted.read(forKey: "manifest"))
        let marker = directory.appendingPathComponent("file-storage-owner")
        try Data("corrupt marker".utf8).write(to: marker)
        XCTAssertNil(restarted.read(forKey: "manifest"))
    }
    func testSeparateLockHandlesSerializeDecisionAndReplacement() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("pca-coordination-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let url = directory.appendingPathComponent("policy.lock")
        let oldCallback = AppGroupDeviceActivityPolicyCoordination(lockFile: url)
        let replacement = AppGroupDeviceActivityPolicyCoordination(lockFile: url)
        let callbackEntered = DispatchSemaphore(value: 0), releaseCallback = DispatchSemaphore(value: 0)
        let replacementAttempted = DispatchSemaphore(value: 0), replacementEntered = DispatchSemaphore(value: 0)
        let callbackDone = expectation(description: "callback finishes")
        let replacementDone = expectation(description: "replacement finishes")
        DispatchQueue.global().async {
            do {
                try oldCallback.withExclusiveAccess {
                    callbackEntered.signal()
                    _ = releaseCallback.wait(timeout: .now() + 5)
                }
            } catch { XCTFail("callback lock failed: \(error)") }
            callbackDone.fulfill()
        }
        XCTAssertEqual(callbackEntered.wait(timeout: .now() + 5), .success)
        DispatchQueue.global().async {
            replacementAttempted.signal()
            do { try replacement.withExclusiveAccess { replacementEntered.signal() } }
            catch { XCTFail("replacement lock failed: \(error)") }
            replacementDone.fulfill()
        }
        XCTAssertEqual(replacementAttempted.wait(timeout: .now() + 5), .success)
        XCTAssertEqual(replacementEntered.wait(timeout: .now() + 0.1), .timedOut)
        releaseCallback.signal()
        XCTAssertEqual(replacementEntered.wait(timeout: .now() + 5), .success)
        wait(for: [callbackDone, replacementDone], timeout: 5)
        // Separate handles exercise OS advisory locking, not physical App Group
        // entitlement, extension lifecycle or DeviceActivity delivery evidence.
    }
}
#endif
