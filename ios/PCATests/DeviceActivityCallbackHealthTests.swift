import XCTest
@testable import PCA

final class DeviceActivityCallbackHealthTests: XCTestCase {
    private let monitor = "monitor-current"
    private let generation = "generation-current"
    private let base = Date(timeIntervalSince1970: 1_748_908_800) // 2025-06-03 00:00 UTC

    private func calendar(_ zone: String = "UTC") -> Calendar {
        var result = Calendar(identifier: .gregorian)
        result.timeZone = TimeZone(identifier: zone)!
        return result
    }
    private func receipt(_ at: Date, monitor: String = "monitor-current", generation: String? = "generation-current") -> ObservedCallback {
        ObservedCallback(kind: .intervalDidStart, observedAt: at, activityId: monitor, installationGeneration: generation)
    }
    private func firstStart() -> ExpectedCallback {
        ExpectedCallback(kind: .intervalDidStart, occurrenceAt: base, observationWindowEndsAt: base.addingTimeInterval(86400), attributionIsUnambiguous: true)
    }
    private func health(_ observations: [ObservedCallback], expected: [ExpectedCallback]? = nil, now: Date? = nil) -> DeviceActivityCallbackHealth {
        DeviceActivityCallbackReconciler.reconcile(expected: expected ?? [firstStart()], observed: observations, activityId: monitor, installationGeneration: generation, nowUtc: now ?? base.addingTimeInterval(3600))
    }

    func testFirstInstallationReceiptCanCertifyDelivery() {
        XCTAssertEqual(health([receipt(base.addingTimeInterval(1))]), .healthy)
    }
    func testDeviceUseDelayedFirstReceiptBeyondTwoMinutesRemainsValid() {
        XCTAssertEqual(health([receipt(base.addingTimeInterval(900))]), .healthy)
    }
    func testMissingReceiptCannotProveDeliveryFailure() {
        XCTAssertEqual(health([]), .unknown)
    }
    func testWrongMonitorAndWrongGenerationCannotCertifyDelivery() {
        XCTAssertEqual(health([receipt(base.addingTimeInterval(1), monitor: "previous")]), .unknown)
        XCTAssertEqual(health([receipt(base.addingTimeInterval(1), generation: "previous")]), .unknown)
        XCTAssertEqual(health([receipt(base.addingTimeInterval(1), generation: nil)]), .unknown)
    }
    func testStaleAndFutureReceiptsCannotCertifyDelivery() {
        XCTAssertEqual(health([receipt(base.addingTimeInterval(-1))]), .unknown)
        XCTAssertEqual(health([receipt(base.addingTimeInterval(4000))]), .unknown)
    }
    func testReceiptAtNextSameKindBoundaryIsAmbiguous() {
        let nextBoundary = base.addingTimeInterval(86400)
        XCTAssertEqual(health([receipt(nextBoundary)], now: nextBoundary.addingTimeInterval(300)), .unknown)
    }
    func testRecurringReceiptWithoutOccurrenceIdentityRemainsUnknown() {
        let tomorrow = base.addingTimeInterval(86400)
        let expected = ExpectedCallback(kind: .intervalDidStart, occurrenceAt: tomorrow, observationWindowEndsAt: tomorrow.addingTimeInterval(86400), attributionIsUnambiguous: false)
        XCTAssertEqual(health([receipt(tomorrow.addingTimeInterval(1))], expected: [expected], now: tomorrow.addingTimeInterval(300)), .unknown)
    }
    func testNoDueExpectationAndGraceRemainUnknown() {
        XCTAssertEqual(health([], expected: []), .unknown)
        XCTAssertEqual(health([], now: base.addingTimeInterval(60)), .unknown)
    }
    func testEventIdentityStillMustMatch() {
        let expected = ExpectedCallback(kind: .eventDidReachThreshold(eventId: "wanted"), occurrenceAt: base, observationWindowEndsAt: base.addingTimeInterval(3600), attributionIsUnambiguous: true)
        let observation = ObservedCallback(kind: .eventDidReachThreshold(eventId: "other"), observedAt: base.addingTimeInterval(1), activityId: monitor, installationGeneration: generation)
        XCTAssertEqual(health([observation], expected: [expected]), .unknown)
    }
    func testMiddayInstallHasOnlyUnambiguousFirstStartAndNoPriorEnd() {
        let installed = base.addingTimeInterval(12 * 3600)
        let expected = DeviceActivityCallbackPlanner.expectedCallbacks(installedAt: installed, now: installed.addingTimeInterval(3600), calendar: calendar())
        XCTAssertEqual(expected.count, 1)
        XCTAssertEqual(expected.first?.occurrenceAt, installed)
        XCTAssertEqual(expected.first?.observationWindowEndsAt, base.addingTimeInterval(86400))
        XCTAssertEqual(expected.first?.attributionIsUnambiguous, true)
    }
    func testNextDayStartIsAmbiguousButFirstEndStillHasUniqueAttribution() {
        let expected = DeviceActivityCallbackPlanner.expectedCallbacks(installedAt: base.addingTimeInterval(12 * 3600), now: base.addingTimeInterval(86400 + 180), calendar: calendar())
        XCTAssertEqual(expected.map(\.kind), [.intervalDidStart, .intervalDidEnd])
        XCTAssertEqual(expected.map(\.attributionIsUnambiguous), [false, true])
        XCTAssertEqual(expected.last?.occurrenceAt, base.addingTimeInterval(23 * 3600 + 59 * 60))
    }
    func testGapAndExactEndInstallWaitForNextFirstStart() {
        let end = base.addingTimeInterval(23 * 3600 + 59 * 60)
        for installed in [end, end.addingTimeInterval(30)] {
            let expected = DeviceActivityCallbackPlanner.expectedCallbacks(installedAt: installed, now: base.addingTimeInterval(86400 + 180), calendar: calendar())
            XCTAssertEqual(expected.count, 1)
            XCTAssertEqual(expected.first?.occurrenceAt, base.addingTimeInterval(86400))
            XCTAssertEqual(expected.first?.attributionIsUnambiguous, true)
        }
    }
    func testSpringAndFallDaylightSavingUseActualCalendarDayLengths() {
        let scheduleCalendar = calendar("America/New_York")
        for (nowText, installedText, hours) in [("2025-03-10T05:03:00Z", "2025-03-08T17:00:00Z", 23), ("2025-11-03T06:03:00Z", "2025-11-01T16:00:00Z", 25)] {
            let now = ISO8601DateFormatter().date(from: nowText)!
            let installed = ISO8601DateFormatter().date(from: installedText)!
            let start = scheduleCalendar.startOfDay(for: now)
            let previousStart = scheduleCalendar.date(byAdding: .day, value: -1, to: start)!
            XCTAssertEqual(start.timeIntervalSince(previousStart), Double(hours * 3600))
            let expected = DeviceActivityCallbackPlanner.expectedCallbacks(installedAt: installed, now: now, calendar: scheduleCalendar)
            XCTAssertEqual(expected.last?.occurrenceAt, scheduleCalendar.date(bySettingHour: 23, minute: 59, second: 0, of: previousStart))
            XCTAssertEqual(expected.first?.attributionIsUnambiguous, false)
        }
    }
}
#if canImport(DeviceActivity) && canImport(FamilyControls) && canImport(ManagedSettings)
import FamilyControls

final class DeviceActivityCallbackRuntimeTests: XCTestCase {
    private let installedAt = ISO8601DateFormatter().date(from: "2025-06-03T12:00:00Z")!
    private let monitor = "pca-monitor-11111111-1111-4111-8111-111111111111"
    private let generation = "22222222-2222-4222-8222-222222222222"

    private func policy(_ id: String = "policy") throws -> Data {
        let value = StoredDeviceActivityPolicy(schemaVersion: 1, activityId: id, appToken: "opaque", timeZoneIdentifier: "UTC", windows: [], bonusGrants: [], exceptions: [], dailyLimit: nil, enforcementCapability: .enforced)
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        return try encoder.encode(value)
    }

    private func installation(_ state: DeviceActivityMonitorInstallationState = .active) -> DeviceActivityMonitorInstallation {
        DeviceActivityMonitorInstallation(policyActivityId: "policy", monitorActivityId: monitor, generation: generation, installedAtUtc: installedAt, timeZoneIdentifier: "UTC", state: state)
    }

    private func seed(_ store: CallbackRuntimeBlobStore, state: DeviceActivityMonitorInstallationState = .active) throws {
        try store.write(policy(), forKey: "schedule.policy")
        try store.write(Data("policy".utf8), forKey: "activeActivityId")
        try store.write(JSONEncoder().encode(installation(state)), forKey: deviceActivityMonitorInstallationStorageKey)
    }

    func testSchedulingFailureInvalidatesPriorInstallationAndStopsBothMonitors() throws {
        let store = CallbackRuntimeBlobStore()
        try seed(store)
        let scheduler = CallbackRuntimeScheduler()
        scheduler.failStart = true
        scheduler.onStart = { id, _ in
            let pending = DeviceActivityMonitorInstallation.decodeValidated(store.read(forKey: deviceActivityMonitorInstallationStorageKey)!)
            XCTAssertEqual(pending?.state, .starting)
            XCTAssertEqual(pending?.monitorActivityId, id)
            XCTAssertNotEqual(id, self.monitor)
            XCTAssertEqual(pending?.installedAtUtc, self.installedAt)
        }
        let runtime = PCAProductionProtectionPolicyRuntime(authorizationIsApproved: { true }, scheduler: scheduler, blobStore: store, callbackLog: InMemoryCallbackObservationLog(), installationClock: { self.installedAt })
        XCTAssertThrowsError(try runtime.applyVerifiedPolicy(scheduleData: policy(), applicationTokenData: PropertyListEncoder().encode(Set<ApplicationToken>()), protectedApplicationTokenData: nil, now: installedAt.addingTimeInterval(-3600))) {
            XCTAssertEqual($0 as? PCAProtectionPolicyApplicationError, .schedulingFailed)
        }
        XCTAssertNil(store.read(forKey: deviceActivityMonitorInstallationStorageKey))
        XCTAssertNil(store.read(forKey: "activeActivityId"))
        XCTAssertTrue(scheduler.stopped.contains(monitor))
        XCTAssertTrue(scheduler.stopped.contains(scheduler.started[0]))
        XCTAssertEqual(runtime.callbackHealth(now: installedAt.addingTimeInterval(180)), .unknown)
    }

    func testFailedActivePersistenceStopsSuccessfullyStartedMonitor() throws {
        let store = CallbackRuntimeBlobStore()
        store.failActiveWrite = true
        let scheduler = CallbackRuntimeScheduler()
        let runtime = PCAProductionProtectionPolicyRuntime(authorizationIsApproved: { true }, scheduler: scheduler, blobStore: store, callbackLog: InMemoryCallbackObservationLog(), installationClock: { self.installedAt })
        XCTAssertThrowsError(try runtime.applyVerifiedPolicy(scheduleData: policy(), applicationTokenData: PropertyListEncoder().encode(Set<ApplicationToken>()), protectedApplicationTokenData: nil, now: installedAt)) {
            XCTAssertEqual($0 as? PCAProtectionPolicyApplicationError, .persistenceFailed)
        }
        XCTAssertEqual(scheduler.started.count, 1)
        XCTAssertEqual(scheduler.stopped, scheduler.started)
        XCTAssertNil(store.read(forKey: "activeActivityId"))
        XCTAssertEqual(runtime.callbackHealth(now: installedAt.addingTimeInterval(180)), .unknown)
    }

    func testPartialPayloadFailureLeavesLegacyActiveIdUnpublished() throws {
        let store = CallbackRuntimeBlobStore()
        try seed(store)
        store.failKey = "applicationTokens.policy"
        store.onWrite = { key in
            if key == "schedule.policy" {
                XCTAssertNil(store.read(forKey: "activeActivityId"))
                XCTAssertNil(store.read(forKey: deviceActivityMonitorInstallationStorageKey))
            }
        }
        let scheduler = CallbackRuntimeScheduler()
        let runtime = PCAProductionProtectionPolicyRuntime(authorizationIsApproved: { true }, scheduler: scheduler, blobStore: store, callbackLog: InMemoryCallbackObservationLog())
        XCTAssertThrowsError(try runtime.applyVerifiedPolicy(scheduleData: policy(), applicationTokenData: PropertyListEncoder().encode(Set<ApplicationToken>()), protectedApplicationTokenData: nil, now: installedAt)) {
            XCTAssertEqual($0 as? PCAProtectionPolicyApplicationError, .persistenceFailed)
        }
        XCTAssertTrue(scheduler.started.isEmpty)
        XCTAssertNil(store.read(forKey: "activeActivityId"))
        XCTAssertNil(store.read(forKey: deviceActivityMonitorInstallationStorageKey))
    }

    func testRestartPreservesInstallationAndRejectsPriorMonitorAndPolicyMismatch() throws {
        let store = CallbackRuntimeBlobStore()
        try seed(store)
        let log = CallbackRuntimeLog()
        log.records = [PersistedCallbackObservation(kind: .intervalDidStart, activityId: monitor, installationGeneration: generation, observedAtUtc: installedAt.addingTimeInterval(1), sequence: 1)]
        let runtime = PCAProductionProtectionPolicyRuntime(authorizationIsApproved: { true }, scheduler: CallbackRuntimeScheduler(), blobStore: store, callbackLog: log)
        let now = installedAt.addingTimeInterval(180)
        XCTAssertEqual(runtime.callbackHealth(now: now), .healthy)
        let restored = PCAProductionProtectionPolicyRuntime(authorizationIsApproved: { true }, scheduler: CallbackRuntimeScheduler(), blobStore: store, callbackLog: log)
        XCTAssertEqual(restored.callbackHealth(now: now), .healthy)
        log.records = [PersistedCallbackObservation(kind: .intervalDidStart, activityId: "pca-monitor-33333333-3333-4333-8333-333333333333", installationGeneration: generation, observedAtUtc: installedAt.addingTimeInterval(1), sequence: 2)]
        XCTAssertEqual(restored.callbackHealth(now: now), .unknown, "old monitor callback must not certify the current installation")
        try store.write(policy("different-policy"), forKey: "schedule.policy")
        XCTAssertEqual(restored.callbackHealth(now: now), .unknown)
    }

    func testStartingCorruptAndMissingInstallationCannotCertifyHealth() throws {
        let store = CallbackRuntimeBlobStore()
        try seed(store, state: .starting)
        let runtime = PCAProductionProtectionPolicyRuntime(authorizationIsApproved: { true }, scheduler: CallbackRuntimeScheduler(), blobStore: store, callbackLog: InMemoryCallbackObservationLog())
        let now = installedAt.addingTimeInterval(180)
        XCTAssertEqual(runtime.callbackHealth(now: now), .unknown)
        try store.write(Data("corrupt".utf8), forKey: deviceActivityMonitorInstallationStorageKey)
        XCTAssertEqual(runtime.callbackHealth(now: now), .unknown)
        store.remove(forKey: deviceActivityMonitorInstallationStorageKey)
        XCTAssertEqual(runtime.callbackHealth(now: now), .unknown)
    }
}

private enum CallbackRuntimeFailure: Error { case injected }
private final class CallbackRuntimeBlobStore: OpaqueBlobStore {
    private var values: [String: Data] = [:]
    var failActiveWrite = false
    var failKey: String?
    var onWrite: ((String) -> Void)?
    func write(_ data: Data, forKey key: String) throws {
        onWrite?(key)
        if key == failKey { throw CallbackRuntimeFailure.injected }
        if failActiveWrite && key == deviceActivityMonitorInstallationStorageKey && DeviceActivityMonitorInstallation.decodeValidated(data)?.state == .active { throw CallbackRuntimeFailure.injected }
        values[key] = data
    }
    func read(forKey key: String) -> Data? { values[key] }
    func remove(forKey key: String) { values.removeValue(forKey: key) }
}
private final class CallbackRuntimeScheduler: PCADeviceActivityScheduler {
    var failStart = false
    var onStart: ((String, Calendar) -> Void)?
    var started: [String] = []
    var stopped: [String] = []
    func start(activityId: String, calendar: Calendar) throws {
        started.append(activityId)
        onStart?(activityId, calendar)
        if failStart { throw CallbackRuntimeFailure.injected }
    }
    func stop(activityId: String) { stopped.append(activityId) }
}
private final class CallbackRuntimeLog: CallbackObservationLog {
    var records: [PersistedCallbackObservation] = []
    func record(kind: DeviceActivityCallbackKind, activityId: String, at: Date) {}
    func readAll() -> [PersistedCallbackObservation] { records }
}
#endif
