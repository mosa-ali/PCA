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
    func testGraceBoundaryRequiresMoreThanTolerance() {
        let expected = [firstStart()]
        let observation = [receipt(base.addingTimeInterval(1))]
        XCTAssertEqual(DeviceActivityCallbackReconciler.reconcile(
            expected: expected, observed: observation, activityId: monitor,
            installationGeneration: generation, nowUtc: base.addingTimeInterval(120)
        ), .unknown)
        XCTAssertEqual(DeviceActivityCallbackReconciler.reconcile(
            expected: expected, observed: observation, activityId: monitor,
            installationGeneration: generation, nowUtc: base.addingTimeInterval(120.001)
        ), .healthy)
    }
    func testObservationAtNowIsAcceptedButFutureByEpsilonIsNot() {
        let now = base.addingTimeInterval(3600)
        XCTAssertEqual(health([receipt(now)], now: now), .healthy)
        XCTAssertEqual(health([receipt(now.addingTimeInterval(0.001))], now: now), .unknown)
    }
    func testReceiptJustBeforeWindowEndCanCertifyDelivery() {
        let windowEnd = base.addingTimeInterval(86400)
        let observation = receipt(windowEnd.addingTimeInterval(-0.001))
        XCTAssertEqual(health([observation], now: windowEnd), .healthy)
    }
    func testInvalidToleranceCannotCertifyHealthOrCreateExpectations() {
        let now = base.addingTimeInterval(60)
        let observation = [receipt(base.addingTimeInterval(1))]
        for tolerance in [-1.0, .nan, .infinity, -.infinity] {
            XCTAssertEqual(DeviceActivityCallbackReconciler.reconcile(
                expected: [firstStart()], observed: observation, activityId: monitor,
                installationGeneration: generation, nowUtc: now, toleranceSeconds: tolerance
            ), .unknown)
            XCTAssertTrue(DeviceActivityCallbackPlanner.expectedCallbacks(
                installedAt: base, now: base.addingTimeInterval(3600), calendar: calendar(),
                toleranceSeconds: tolerance
            ).isEmpty)
        }
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
import ManagedSettings

final class DeviceActivityCallbackRuntimeTests: XCTestCase {
    private final class NonReentrantCoordination: DeviceActivityPolicyCoordination {
        private enum TestError: Error { case nestedAcquisition }
        private let lock = NSRecursiveLock()
        private var depth = 0
        private(set) var acquisitions = 0

        func withExclusiveAccess<T>(_ operation: () throws -> T) throws -> T {
            lock.lock()
            defer { lock.unlock() }
            guard depth == 0 else { throw TestError.nestedAcquisition }
            depth += 1
            acquisitions += 1
            defer { depth -= 1 }
            return try operation()
        }

        func resetAcquisitions() {
            lock.lock()
            acquisitions = 0
            lock.unlock()
        }
    }

    private final class ShieldRecorder: PCADeviceActivityShieldEnforcing {
        var applyCount = 0
        var removeCount = 0
        func apply(applications: Set<ApplicationToken>, protectedApplications: Set<ApplicationToken>) throws { applyCount += 1 }
        func removeAll() { removeCount += 1 }
    }

    func testUsageBindingProviderReceivesHeldAccessForApplyAndRenewal() throws {
        let coordination = NonReentrantCoordination()
        let store = CallbackRuntimeBlobStore()
        var providerAccesses: [DeviceActivityPolicyLockAccess] = []
        let runtime = PCAProductionProtectionPolicyRuntime(authorizationIsApproved: { true },
            scheduler: CallbackRuntimeScheduler(), blobStore: store,
            installationClock: { self.installedAt }, policyCoordination: coordination,
            usageBindingProvider: { _, _, access in
                providerAccesses.append(access)
                XCTAssertTrue(access.isActive(for: coordination))
                return nil
            })

        coordination.resetAcquisitions()
        let tokens = try PropertyListEncoder().encode(Set<ApplicationToken>())
        let dailyPolicy = try boundaryPolicy(daily: true)
        XCTAssertEqual(try runtime.applyVerifiedPolicy(scheduleData: dailyPolicy,
            applicationTokenData: tokens, protectedApplicationTokenData: nil, now: installedAt), .degraded)
        XCTAssertEqual(try runtime.renewInstalledUsageMonitor(now: installedAt.addingTimeInterval(60)), .degraded)

        XCTAssertEqual(providerAccesses.count, 2)
        XCTAssertEqual(coordination.acquisitions, 2, "apply and renewal each acquire the coordinator once")
        XCTAssertTrue(providerAccesses.allSatisfy { !$0.isActive(for: coordination) },
            "access must expire before the coordinator lock is released")
        let installation = try XCTUnwrap(DeviceActivityMonitorInstallation.decodeValidated(
            try XCTUnwrap(store.read(forKey: deviceActivityMonitorInstallationStorageKey))))
        XCTAssertEqual(installation.schemaVersion, 2)
        XCTAssertNil(installation.usageDayPlan, "a nil provider must not fabricate usage coverage")
    }

    func testActiveManifestReadersSurviveBestEffortPointerRepairFailure() throws {
        let store = CallbackRuntimeBlobStore(), scheduler = CallbackRuntimeScheduler()
        let writer = PCAProductionProtectionPolicyRuntime(authorizationIsApproved: { true },
            scheduler: scheduler, blobStore: store, installationClock: { self.installedAt })
        _ = try writer.applyVerifiedPolicy(scheduleData: policy(),
            applicationTokenData: PropertyListEncoder().encode(Set<ApplicationToken>()),
            protectedApplicationTokenData: nil, now: installedAt)
        let committed = try XCTUnwrap(DeviceActivityMonitorInstallation.decodeValidated(
            try XCTUnwrap(store.read(forKey: deviceActivityMonitorInstallationStorageKey))))
        scheduler.orphanIds = committed.allMonitorActivityIds
        try store.write(Data("stale-pointer".utf8), forKey: "activeActivityId")
        store.failNextActiveMirrorWrite = true
        let log = CallbackRuntimeLog()
        log.records = [PersistedCallbackObservation(kind: .intervalDidStart,
            activityId: committed.monitorActivityId, installationGeneration: committed.generation,
            observedAtUtc: installedAt.addingTimeInterval(1), sequence: 1)]

        let recovered = PCAProductionProtectionPolicyRuntime(authorizationIsApproved: { true },
            scheduler: scheduler, blobStore: store, callbackLog: log,
            installationClock: { self.installedAt })
        XCTAssertEqual(store.read(forKey: "activeActivityId"), Data("stale-pointer".utf8),
            "the injected best-effort mirror repair failure must leave the active manifest readable")
        XCTAssertEqual(recovered.callbackHealth(now: installedAt.addingTimeInterval(180)), .healthy)
        XCTAssertEqual(try recovered.renewInstalledUsageMonitor(now: installedAt.addingTimeInterval(60)), .applied)
        XCTAssertEqual(store.read(forKey: "activeActivityId"), Data("policy".utf8),
            "a later successful publication repairs the compatibility mirror")
    }

    func testRegistrationAndPublicationFailuresDoNotMutateExistingShields() throws {
        for failure in ["payload", "schedule", "publication"] {
            let store = CallbackRuntimeBlobStore(), scheduler = CallbackRuntimeScheduler(), shields = ShieldRecorder()
            if failure == "payload" { store.failKey = "schedule.policy" }
            if failure == "schedule" { scheduler.failStart = true }
            if failure == "publication" { store.failActiveWrite = true }
            let runtime = PCAProductionProtectionPolicyRuntime(authorizationIsApproved: { true },
                scheduler: scheduler, blobStore: store, installationClock: { self.installedAt }, shieldEnforcer: shields)
            XCTAssertThrowsError(try runtime.applyVerifiedPolicy(scheduleData: policy(),
                applicationTokenData: PropertyListEncoder().encode(Set<ApplicationToken>()),
                protectedApplicationTokenData: nil, now: installedAt))
            XCTAssertEqual(shields.applyCount, 0, failure)
            XCTAssertEqual(shields.removeCount, 0, failure)
        }
    }
    func testExplicitPolicyClearUsesEnforcementPortOnlyForMatchingPolicy() throws {
        let store = CallbackRuntimeBlobStore(), shields = ShieldRecorder()
        let runtime = PCAProductionProtectionPolicyRuntime(authorizationIsApproved: { true },
            scheduler: CallbackRuntimeScheduler(), blobStore: store,
            installationClock: { self.installedAt }, shieldEnforcer: shields)
        _ = try runtime.applyVerifiedPolicy(scheduleData: policy(),
            applicationTokenData: PropertyListEncoder().encode(Set<ApplicationToken>()),
            protectedApplicationTokenData: nil, now: installedAt)
        let count = shields.removeCount
        runtime.clearPolicy(activityId: "unrelated")
        XCTAssertEqual(shields.removeCount, count)
        runtime.clearPolicy(activityId: "policy")
        XCTAssertEqual(shields.removeCount, count + 1)
    }
    func testInstalledPolicyRenewalFailureKeepsPreviousGenerationActive() throws {
        let store = CallbackRuntimeBlobStore(), scheduler = CallbackRuntimeScheduler(), shields = ShieldRecorder()
        let runtime = PCAProductionProtectionPolicyRuntime(authorizationIsApproved: { true },
            scheduler: scheduler, blobStore: store, installationClock: { self.installedAt }, shieldEnforcer: shields)
        _ = try runtime.applyVerifiedPolicy(scheduleData: policy(),
            applicationTokenData: PropertyListEncoder().encode(Set<ApplicationToken>()),
            protectedApplicationTokenData: nil, now: installedAt)
        let priorData = try XCTUnwrap(store.read(forKey: deviceActivityMonitorInstallationStorageKey))
        let prior = try XCTUnwrap(DeviceActivityMonitorInstallation.decodeValidated(priorData))
        let priorMutationCount = shields.removeCount
        let startedCount = scheduler.started.count
        scheduler.failStart = true
        XCTAssertThrowsError(try runtime.renewInstalledUsageMonitor(now: installedAt.addingTimeInterval(86400))) {
            XCTAssertEqual($0 as? PCAProtectionPolicyApplicationError, .schedulingFailed)
        }
        XCTAssertEqual(shields.removeCount, priorMutationCount)
        XCTAssertEqual(shields.applyCount, 0)
        XCTAssertEqual(store.read(forKey: deviceActivityMonitorInstallationStorageKey), priorData)
        XCTAssertEqual(store.read(forKey: "activeActivityId"), Data("policy".utf8))
        let attempted = Array(scheduler.started.dropFirst(startedCount))
        XCTAssertFalse(attempted.isEmpty)
        XCTAssertTrue(attempted.allSatisfy { scheduler.stopped.contains($0) })
        XCTAssertTrue(prior.allMonitorActivityIds.allSatisfy { !scheduler.stopped.contains($0) })
        XCTAssertNotNil(StoredDeviceActivityPolicyLoader<ApplicationToken>(scheduleStore: store, tokenStore: store)
            .load(activityId: "policy", storageGeneration: prior.payloadStorageGeneration))
    }
    func testReplacementPublicationFailureRestoresPriorPolicyAndMonitors() throws {
        let store = CallbackRuntimeBlobStore(), scheduler = CallbackRuntimeScheduler(), shields = ShieldRecorder()
        let runtime = PCAProductionProtectionPolicyRuntime(authorizationIsApproved: { true },
            scheduler: scheduler, blobStore: store, installationClock: { self.installedAt }, shieldEnforcer: shields)
        _ = try runtime.applyVerifiedPolicy(scheduleData: policy(),
            applicationTokenData: PropertyListEncoder().encode(Set<ApplicationToken>()),
            protectedApplicationTokenData: nil, now: installedAt)
        let priorData = try XCTUnwrap(store.read(forKey: deviceActivityMonitorInstallationStorageKey))
        let prior = try XCTUnwrap(DeviceActivityMonitorInstallation.decodeValidated(priorData))
        let priorActive = try XCTUnwrap(store.read(forKey: "activeActivityId"))
        let priorMutationCount = shields.applyCount
        let startedCount = scheduler.started.count

        store.failNextActiveManifestVerification = true
        XCTAssertThrowsError(try runtime.applyVerifiedPolicy(scheduleData: policy(),
            applicationTokenData: PropertyListEncoder().encode(Set<ApplicationToken>()),
            protectedApplicationTokenData: nil, now: installedAt.addingTimeInterval(60))) {
            XCTAssertEqual($0 as? PCAProtectionPolicyApplicationError, .persistenceFailed)
        }
        XCTAssertEqual(store.activeManifestVerificationFailureCount, 1,
            "the injected failure must hit the replacement manifest readback")

        XCTAssertEqual(store.read(forKey: deviceActivityMonitorInstallationStorageKey), priorData)
        XCTAssertEqual(store.read(forKey: "activeActivityId"), priorActive)
        XCTAssertEqual(shields.applyCount, priorMutationCount)
        XCTAssertTrue(prior.allMonitorActivityIds.allSatisfy { !scheduler.stopped.contains($0) })
        let attempted = Array(scheduler.started.dropFirst(startedCount))
        XCTAssertFalse(attempted.isEmpty)
        XCTAssertTrue(attempted.allSatisfy { scheduler.stopped.contains($0) })
        XCTAssertNotNil(StoredDeviceActivityPolicyLoader<ApplicationToken>(scheduleStore: store, tokenStore: store)
            .load(activityId: "policy", storageGeneration: prior.payloadStorageGeneration))
    }
    func testRelaunchUsesCommittedManifestAndRepairsPointerAfterInterruptedPublish() throws {
        let store = CallbackRuntimeBlobStore()
        try seed(store)
        let prior = try XCTUnwrap(DeviceActivityMonitorInstallation.decodeValidated(
            XCTUnwrap(store.read(forKey: deviceActivityMonitorInstallationStorageKey))))
        let nextGeneration = "44444444-4444-4444-8444-444444444444"
        let nextMonitor = "pca-monitor-55555555-5555-4555-8555-555555555555"
        let nextPolicy = try policy("policy-next")
        try store.write(nextPolicy, forKey: "schedule.policy-next.\(nextGeneration)")
        try store.write(PropertyListEncoder().encode(Set<ApplicationToken>()),
            forKey: "applicationTokens.policy-next.\(nextGeneration)")
        try store.write(PropertyListEncoder().encode(Set<ApplicationToken>()),
            forKey: "protectedApplicationTokens.\(nextGeneration)")
        let committed = DeviceActivityMonitorInstallation(policyActivityId: "policy-next",
            monitorActivityId: nextMonitor, generation: nextGeneration, installedAtUtc: installedAt,
            timeZoneIdentifier: "UTC", state: .active, schemaVersion: 2, boundaryMonitors: [])
        try store.write(JSONEncoder().encode(committed), forKey: deviceActivityMonitorInstallationStorageKey)
        // The process stopped after the manifest write and before updating the
        // compatibility pointer. Both old and staged monitor names may exist.
        XCTAssertEqual(store.read(forKey: "activeActivityId"), Data("policy".utf8))
        XCTAssertNotNil(InstalledDeviceActivityPolicyLoader<ApplicationToken>(scheduleStore: store, tokenStore: store)
            .load(monitorActivityId: nextMonitor))

        let scheduler = CallbackRuntimeScheduler()
        scheduler.orphanIds = prior.allMonitorActivityIds + [nextMonitor]
        _ = PCAProductionProtectionPolicyRuntime(authorizationIsApproved: { true },
            scheduler: scheduler, blobStore: store, installationClock: { self.installedAt })

        XCTAssertEqual(store.read(forKey: "activeActivityId"), Data("policy-next".utf8))
        XCTAssertTrue(scheduler.stopped.contains(prior.monitorActivityId))
        XCTAssertFalse(scheduler.stopped.contains(nextMonitor))
        XCTAssertNotNil(InstalledDeviceActivityPolicyLoader<ApplicationToken>(scheduleStore: store, tokenStore: store)
            .load(monitorActivityId: nextMonitor))
    }
    func testRelaunchBeforeManifestPublicationReclaimsStagedIdsBeforeRestoringFullGeneration() throws {
        let store = CallbackRuntimeBlobStore()
        let firstScheduler = CallbackRuntimeScheduler()
        let first = PCAProductionProtectionPolicyRuntime(authorizationIsApproved: { true },
            scheduler: firstScheduler, blobStore: store, installationClock: { self.installedAt })
        let fullPolicy = try boundaryPolicy(windowCount: 9, daily: true)
        _ = try first.applyVerifiedPolicy(scheduleData: fullPolicy,
            applicationTokenData: PropertyListEncoder().encode(Set<ApplicationToken>()),
            protectedApplicationTokenData: nil, now: installedAt)
        let priorData = try XCTUnwrap(store.read(forKey: deviceActivityMonitorInstallationStorageKey))
        let prior = try XCTUnwrap(DeviceActivityMonitorInstallation.decodeValidated(priorData))
        XCTAssertEqual(prior.allMonitorActivityIds.count, DeviceActivityScheduleMapper.maximumMonitoredActivities)

        // Simulate process death after the old generation was stopped and a
        // subset of the distinct replacement names reached the OS, before its
        // active manifest became durable.
        let stagedIds = (0..<7).map { _ in "pca-monitor-\(UUID().uuidString.lowercased())" }
        let recoveryScheduler = CallbackRuntimeScheduler()
        recoveryScheduler.orphanIds = stagedIds
        _ = PCAProductionProtectionPolicyRuntime(authorizationIsApproved: { true },
            scheduler: recoveryScheduler, blobStore: store, installationClock: { self.installedAt })

        XCTAssertTrue(stagedIds.allSatisfy { recoveryScheduler.stopped.contains($0) })
        XCTAssertTrue(prior.allMonitorActivityIds.allSatisfy { recoveryScheduler.ownedMonitorActivityIds().contains($0) })
        let lastOrphanStop = try XCTUnwrap(recoveryScheduler.events.lastIndex(where: { $0.hasPrefix("stop:") }))
        let firstCommittedRestore = try XCTUnwrap(recoveryScheduler.events.firstIndex(where: {
            $0.hasPrefix("start:") && prior.allMonitorActivityIds.contains(String($0.dropFirst("start:".count)))
        }))
        XCTAssertLessThan(lastOrphanStop, firstCommittedRestore,
            "free uncommitted slots before restoring the manifest's committed 20-monitor generation")
        XCTAssertEqual(store.read(forKey: deviceActivityMonitorInstallationStorageKey), priorData)
        XCTAssertEqual(store.read(forKey: "activeActivityId"), Data("policy".utf8))
    }

    func testFullCapacityReplacementFailureRestoresPriorGenerationAndSuccessfulSwapRetiresIt() throws {
        let store = CallbackRuntimeBlobStore()
        let firstScheduler = CallbackRuntimeScheduler()
        let first = PCAProductionProtectionPolicyRuntime(authorizationIsApproved: { true },
            scheduler: firstScheduler, blobStore: store, installationClock: { self.installedAt })
        let fullPolicy = try boundaryPolicy(windowCount: 9, daily: true)
        let tokens = try PropertyListEncoder().encode(Set<ApplicationToken>())
        _ = try first.applyVerifiedPolicy(scheduleData: fullPolicy, applicationTokenData: tokens,
            protectedApplicationTokenData: nil, now: installedAt)
        let priorData = try XCTUnwrap(store.read(forKey: deviceActivityMonitorInstallationStorageKey))
        let prior = try XCTUnwrap(DeviceActivityMonitorInstallation.decodeValidated(priorData))
        XCTAssertEqual(prior.allMonitorActivityIds.count, DeviceActivityScheduleMapper.maximumMonitoredActivities)

        let failingScheduler = CallbackRuntimeScheduler()
        failingScheduler.orphanIds = prior.allMonitorActivityIds
        failingScheduler.failAtStart = 1 // first replacement registration fails after releasing the old generation
        let failingRuntime = PCAProductionProtectionPolicyRuntime(authorizationIsApproved: { true },
            scheduler: failingScheduler, blobStore: store, installationClock: { self.installedAt })
        XCTAssertThrowsError(try failingRuntime.applyVerifiedPolicy(scheduleData: fullPolicy,
            applicationTokenData: tokens,
            protectedApplicationTokenData: nil, now: installedAt.addingTimeInterval(60))) {
            XCTAssertEqual($0 as? PCAProtectionPolicyApplicationError, .schedulingFailed)
        }
        XCTAssertEqual(store.read(forKey: deviceActivityMonitorInstallationStorageKey), priorData)
        XCTAssertEqual(store.read(forKey: "activeActivityId"), Data("policy".utf8))
        XCTAssertTrue(prior.allMonitorActivityIds.allSatisfy { failingScheduler.ownedMonitorActivityIds().contains($0) })
        XCTAssertFalse(failingScheduler.ownedMonitorActivityIds().contains { !prior.allMonitorActivityIds.contains($0) })
        XCTAssertNotNil(InstalledDeviceActivityPolicyLoader<ApplicationToken>(scheduleStore: store, tokenStore: store)
            .load(monitorActivityId: prior.monitorActivityId))

        let replacementScheduler = CallbackRuntimeScheduler()
        replacementScheduler.orphanIds = prior.allMonitorActivityIds
        let replacement = PCAProductionProtectionPolicyRuntime(authorizationIsApproved: { true },
            scheduler: replacementScheduler, blobStore: store, installationClock: { self.installedAt })
        _ = try replacement.applyVerifiedPolicy(scheduleData: fullPolicy,
            applicationTokenData: PropertyListEncoder().encode(Set<ApplicationToken>()),
            protectedApplicationTokenData: nil, now: installedAt.addingTimeInterval(120))
        let current = try XCTUnwrap(DeviceActivityMonitorInstallation.decodeValidated(
            try XCTUnwrap(store.read(forKey: deviceActivityMonitorInstallationStorageKey))))
        XCTAssertNotEqual(current.generation, prior.generation)
        XCTAssertEqual(current.allMonitorActivityIds.count, DeviceActivityScheduleMapper.maximumMonitoredActivities)
        XCTAssertTrue(prior.allMonitorActivityIds.allSatisfy { replacementScheduler.stopped.contains($0) })
        XCTAssertTrue(current.allMonitorActivityIds.allSatisfy { replacementScheduler.ownedMonitorActivityIds().contains($0) })
        XCTAssertNotNil(InstalledDeviceActivityPolicyLoader<ApplicationToken>(scheduleStore: store, tokenStore: store)
            .load(monitorActivityId: current.monitorActivityId))
    }
    func testRenewalRejectsCorruptStoredPolicyBeforeRetiringActiveGeneration() throws {
        let store = CallbackRuntimeBlobStore(), scheduler = CallbackRuntimeScheduler(), shields = ShieldRecorder()
        let runtime = PCAProductionProtectionPolicyRuntime(authorizationIsApproved: { true },
            scheduler: scheduler, blobStore: store, installationClock: { self.installedAt }, shieldEnforcer: shields)
        _ = try runtime.applyVerifiedPolicy(scheduleData: policy(),
            applicationTokenData: PropertyListEncoder().encode(Set<ApplicationToken>()),
            protectedApplicationTokenData: nil, now: installedAt)
        let original = try XCTUnwrap(store.read(forKey: deviceActivityMonitorInstallationStorageKey))
        let manifest = try XCTUnwrap(DeviceActivityMonitorInstallation.decodeValidated(original))
        try store.write(Data("corrupt".utf8), forKey: "schedule.policy." + manifest.generation)
        let mutationCount = shields.removeCount
        XCTAssertThrowsError(try runtime.renewInstalledUsageMonitor(now: installedAt))
        XCTAssertEqual(store.read(forKey: deviceActivityMonitorInstallationStorageKey), original)
        XCTAssertEqual(store.read(forKey: "activeActivityId"), Data("policy".utf8))
        XCTAssertTrue(scheduler.stopped.isEmpty)
        XCTAssertEqual(shields.removeCount, mutationCount)
    }
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

    func testSchedulingFailurePreservesPriorInstallationAndStopsOnlyStagedMonitor() throws {
        let store = CallbackRuntimeBlobStore()
        try seed(store)
        let priorInstallation = try XCTUnwrap(store.read(forKey: deviceActivityMonitorInstallationStorageKey))
        let priorActive = try XCTUnwrap(store.read(forKey: "activeActivityId"))
        let scheduler = CallbackRuntimeScheduler()
        scheduler.orphanIds = [monitor]
        scheduler.failStart = true
        scheduler.onStart = { id, _ in
            let pending = DeviceActivityMonitorInstallation.decodeValidated(store.read(forKey: deviceActivityMonitorInstallationStorageKey)!)
            XCTAssertEqual(pending?.state, .active)
            XCTAssertEqual(pending?.monitorActivityId, self.monitor)
            XCTAssertNotEqual(id, self.monitor)
            XCTAssertEqual(pending?.installedAtUtc, self.installedAt)
        }
        let runtime = PCAProductionProtectionPolicyRuntime(authorizationIsApproved: { true }, scheduler: scheduler, blobStore: store, callbackLog: InMemoryCallbackObservationLog(), installationClock: { self.installedAt })
        XCTAssertThrowsError(try runtime.applyVerifiedPolicy(scheduleData: policy(), applicationTokenData: PropertyListEncoder().encode(Set<ApplicationToken>()), protectedApplicationTokenData: nil, now: installedAt.addingTimeInterval(-3600))) {
            XCTAssertEqual($0 as? PCAProtectionPolicyApplicationError, .schedulingFailed)
        }
        XCTAssertEqual(store.read(forKey: deviceActivityMonitorInstallationStorageKey), priorInstallation)
        XCTAssertEqual(store.read(forKey: "activeActivityId"), priorActive)
        XCTAssertFalse(scheduler.stopped.contains(monitor))
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

    func testPartialPayloadFailurePreservesLegacyActiveIdUntilNewCommit() throws {
        let store = CallbackRuntimeBlobStore()
        try store.write(policy(), forKey: "schedule.policy")
        try store.write(Data("policy".utf8), forKey: "activeActivityId")
        store.failKey = "applicationTokens.policy"
        store.onWrite = { key in
            if key.hasPrefix("schedule.policy") {
                XCTAssertEqual(store.read(forKey: "activeActivityId"), Data("policy".utf8))
                XCTAssertNil(store.read(forKey: deviceActivityMonitorInstallationStorageKey))
            }
        }
        let scheduler = CallbackRuntimeScheduler()
        let runtime = PCAProductionProtectionPolicyRuntime(authorizationIsApproved: { true }, scheduler: scheduler, blobStore: store, callbackLog: InMemoryCallbackObservationLog())
        XCTAssertThrowsError(try runtime.applyVerifiedPolicy(scheduleData: policy(), applicationTokenData: PropertyListEncoder().encode(Set<ApplicationToken>()), protectedApplicationTokenData: nil, now: installedAt)) {
            XCTAssertEqual($0 as? PCAProtectionPolicyApplicationError, .persistenceFailed)
        }
        XCTAssertTrue(scheduler.started.isEmpty)
        XCTAssertEqual(store.read(forKey: "activeActivityId"), Data("policy".utf8))
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
    private func boundaryPolicy(windowCount: Int = 1, daily: Bool = false) throws -> Data {
        let windows = (0..<windowCount).map { StoredScheduleWindow(id: "w\($0)", kind: .bedtime, daysOfWeek: [1,2,3,4,5,6,7], start: .init(hour: $0, minute: 0), end: .init(hour: $0, minute: 1), appScope: .all, timezone: "UTC") }
        let limit = daily ? StoredDailyAppLimit(appScope: .all, limitMinutes: 60, usedMinutesToday: 0, anchorLocalDate: "2025-06-03") : nil
        let policy = StoredDeviceActivityPolicy(schemaVersion: 1, activityId: "policy", appToken: "opaque", timeZoneIdentifier: "Asia/Riyadh", windows: windows, bonusGrants: [], exceptions: [], dailyLimit: limit, enforcementCapability: .enforced)
        let encoder = JSONEncoder(); encoder.dateEncodingStrategy = .iso8601
        return try encoder.encode(policy)
    }
    func testBoundaryGroupBecomesActiveOnlyAfterEveryRegistration() throws {
        let store = CallbackRuntimeBlobStore(), scheduler = CallbackRuntimeScheduler()
        scheduler.onStart = { id, _ in
            XCTAssertNil(store.read(forKey: deviceActivityMonitorInstallationStorageKey),
                "staged monitors are not published until every registration succeeds")
            XCTAssertNil(store.read(forKey: "activeActivityId"))
            XCTAssertNil(InstalledDeviceActivityPolicyLoader<ApplicationToken>(scheduleStore: store, tokenStore: store)
                .load(monitorActivityId: id), "staged monitors cannot load an uncommitted policy")
        }
        let runtime = PCAProductionProtectionPolicyRuntime(authorizationIsApproved: { true }, scheduler: scheduler, blobStore: store, installationClock: { self.installedAt })
        _ = try runtime.applyVerifiedPolicy(scheduleData: boundaryPolicy(), applicationTokenData: PropertyListEncoder().encode(Set<ApplicationToken>()), protectedApplicationTokenData: nil, now: installedAt)
        let manifest = try XCTUnwrap(DeviceActivityMonitorInstallation.decodeValidated(store.read(forKey: deviceActivityMonitorInstallationStorageKey)!))
        XCTAssertEqual(manifest.schemaVersion, 2)
        XCTAssertEqual(manifest.state, .active)
        XCTAssertEqual(manifest.boundaryMonitors?.count, 2)
        XCTAssertEqual(Set(scheduler.started), Set(manifest.allMonitorActivityIds))
        XCTAssertNotNil(store.read(forKey: "protectedApplicationTokens.\(manifest.generation)"))
        XCTAssertNotNil(InstalledDeviceActivityPolicyLoader<ApplicationToken>(scheduleStore: store, tokenStore: store).load(monitorActivityId: manifest.boundaryMonitors![0].activityId))
        runtime.clearPolicy(activityId: "unrelated")
        XCTAssertTrue(scheduler.stopped.isEmpty)
        runtime.clearPolicy(activityId: "policy")
        XCTAssertEqual(Set(scheduler.stopped), Set(manifest.allMonitorActivityIds))
        XCTAssertNil(store.read(forKey: "activeActivityId"))
    }
    func testEveryRegistrationFailurePositionStopsEntireStagedSet() throws {
        for failAt in 1...3 {
            let store = CallbackRuntimeBlobStore(), scheduler = CallbackRuntimeScheduler()
            scheduler.failAtStart = failAt
            let runtime = PCAProductionProtectionPolicyRuntime(authorizationIsApproved: { true }, scheduler: scheduler, blobStore: store, installationClock: { self.installedAt })
            XCTAssertThrowsError(try runtime.applyVerifiedPolicy(scheduleData: boundaryPolicy(), applicationTokenData: PropertyListEncoder().encode(Set<ApplicationToken>()), protectedApplicationTokenData: nil, now: installedAt)) {
                XCTAssertEqual($0 as? PCAProtectionPolicyApplicationError, .schedulingFailed)
            }
            XCTAssertTrue(Set(scheduler.started).isSubset(of: Set(scheduler.stopped)))
            XCTAssertEqual(scheduler.stopped.count, 3, "anchor and both boundary names are reclaimed")
            XCTAssertNil(store.read(forKey: "activeActivityId"))
            XCTAssertNil(store.read(forKey: deviceActivityMonitorInstallationStorageKey))
        }
    }
    func testTwentyMonitorCeilingSucceedsAndLastRegistrationFailureRetiresAll() throws {
        for failLast in [false, true] {
            let store = CallbackRuntimeBlobStore(), scheduler = CallbackRuntimeScheduler()
            if failLast { scheduler.failAtStart = 20 }
            let runtime = PCAProductionProtectionPolicyRuntime(authorizationIsApproved: { true }, scheduler: scheduler, blobStore: store, installationClock: { self.installedAt })
            let data = try boundaryPolicy(windowCount: 9, daily: true)
            let tokens = try PropertyListEncoder().encode(Set<ApplicationToken>())
            if failLast {
                XCTAssertThrowsError(try runtime.applyVerifiedPolicy(scheduleData: data, applicationTokenData: tokens, protectedApplicationTokenData: nil, now: installedAt))
                XCTAssertEqual(Set(scheduler.stopped), Set(scheduler.started))
                XCTAssertNil(store.read(forKey: "activeActivityId"))
            } else {
                _ = try runtime.applyVerifiedPolicy(scheduleData: data, applicationTokenData: tokens, protectedApplicationTokenData: nil, now: installedAt)
                let manifest = try XCTUnwrap(DeviceActivityMonitorInstallation.decodeValidated(store.read(forKey: deviceActivityMonitorInstallationStorageKey)!))
                XCTAssertEqual(manifest.boundaryMonitors?.count, 19)
                XCTAssertEqual(manifest.allMonitorActivityIds.count, 20)
            }
            XCTAssertEqual(scheduler.started.count, 20)
        }
    }
    func testExcessBoundariesRejectBeforeReplacingPriorState() throws {
        let store = CallbackRuntimeBlobStore(); try seed(store)
        let before = store.read(forKey: deviceActivityMonitorInstallationStorageKey)
        let scheduler = CallbackRuntimeScheduler()
        scheduler.orphanIds = [monitor]
        let runtime = PCAProductionProtectionPolicyRuntime(authorizationIsApproved: { true }, scheduler: scheduler, blobStore: store, installationClock: { self.installedAt })
        XCTAssertThrowsError(try runtime.applyVerifiedPolicy(scheduleData: boundaryPolicy(windowCount: 10), applicationTokenData: PropertyListEncoder().encode(Set<ApplicationToken>()), protectedApplicationTokenData: nil, now: installedAt)) {
            XCTAssertEqual($0 as? PCAProtectionPolicyApplicationError, .unsupportedSchedule)
        }
        XCTAssertEqual(store.read(forKey: deviceActivityMonitorInstallationStorageKey), before)
        XCTAssertTrue(scheduler.started.isEmpty && scheduler.stopped.isEmpty)
    }
    func testRestartRetiresIncompleteGroupAndReplacementStopsPreviousGroup() throws {
        let store = CallbackRuntimeBlobStore(), firstScheduler = CallbackRuntimeScheduler()
        let first = PCAProductionProtectionPolicyRuntime(authorizationIsApproved: { true }, scheduler: firstScheduler, blobStore: store, installationClock: { self.installedAt })
        _ = try first.applyVerifiedPolicy(scheduleData: boundaryPolicy(), applicationTokenData: PropertyListEncoder().encode(Set<ApplicationToken>()), protectedApplicationTokenData: nil, now: installedAt)
        let old = try XCTUnwrap(DeviceActivityMonitorInstallation.decodeValidated(store.read(forKey: deviceActivityMonitorInstallationStorageKey)!))
        let secondScheduler = CallbackRuntimeScheduler()
        let second = PCAProductionProtectionPolicyRuntime(authorizationIsApproved: { true }, scheduler: secondScheduler, blobStore: store, installationClock: { self.installedAt })
        _ = try second.applyVerifiedPolicy(scheduleData: boundaryPolicy(), applicationTokenData: PropertyListEncoder().encode(Set<ApplicationToken>()), protectedApplicationTokenData: nil, now: installedAt)
        XCTAssertTrue(Set(old.allMonitorActivityIds).isSubset(of: Set(secondScheduler.stopped)))
        XCTAssertNil(store.read(forKey: "schedule.policy.\(old.generation)"))
        let current = try XCTUnwrap(DeviceActivityMonitorInstallation.decodeValidated(store.read(forKey: deviceActivityMonitorInstallationStorageKey)!))
        let incomplete = DeviceActivityMonitorInstallation(policyActivityId: current.policyActivityId, monitorActivityId: current.monitorActivityId, generation: current.generation, installedAtUtc: current.installedAtUtc, timeZoneIdentifier: current.timeZoneIdentifier, state: .starting, schemaVersion: 2, boundaryMonitors: current.boundaryMonitors)
        try store.write(JSONEncoder().encode(incomplete), forKey: deviceActivityMonitorInstallationStorageKey)
        let restartScheduler = CallbackRuntimeScheduler()
        _ = PCAProductionProtectionPolicyRuntime(authorizationIsApproved: { true }, scheduler: restartScheduler, blobStore: store)
        XCTAssertEqual(Set(restartScheduler.stopped), Set(current.allMonitorActivityIds))
        XCTAssertNil(store.read(forKey: deviceActivityMonitorInstallationStorageKey))
    }
    func testFailedActivationVerificationAndRemovalRetainsNonActiveTombstone() throws {
        let store = CallbackRuntimeBlobStore(), scheduler = CallbackRuntimeScheduler()
        store.ignoreRemovals = true
        store.failNextActiveManifestVerification = true
        let runtime = PCAProductionProtectionPolicyRuntime(authorizationIsApproved: { true }, scheduler: scheduler, blobStore: store, installationClock: { self.installedAt })
        XCTAssertThrowsError(try runtime.applyVerifiedPolicy(scheduleData: boundaryPolicy(), applicationTokenData: PropertyListEncoder().encode(Set<ApplicationToken>()), protectedApplicationTokenData: nil, now: installedAt)) {
            XCTAssertEqual($0 as? PCAProtectionPolicyApplicationError, .persistenceFailed)
        }
        XCTAssertEqual(store.activeManifestVerificationFailureCount, 1,
            "the injected failure must hit the first-install manifest readback")
        let manifest = try XCTUnwrap(DeviceActivityMonitorInstallation.decodeValidated(store.read(forKey: deviceActivityMonitorInstallationStorageKey)!))
        XCTAssertEqual(manifest.state, .invalidated)
        XCTAssertNil(store.read(forKey: "activeActivityId"),
            "manifest verification failed before writing the compatibility mirror")
        XCTAssertEqual(Set(scheduler.stopped), Set(manifest.allMonitorActivityIds))
        for id in manifest.allMonitorActivityIds {
            XCTAssertNil(InstalledDeviceActivityPolicyLoader<ApplicationToken>(scheduleStore: store, tokenStore: store).load(monitorActivityId: id))
        }
    }
    func testFailedClearInvalidationPreservesActiveStateAndDoesNotRetireMonitors() throws {
        let store = CallbackRuntimeBlobStore(), scheduler = CallbackRuntimeScheduler()
        let runtime = PCAProductionProtectionPolicyRuntime(authorizationIsApproved: { true }, scheduler: scheduler, blobStore: store, installationClock: { self.installedAt })
        _ = try runtime.applyVerifiedPolicy(scheduleData: boundaryPolicy(), applicationTokenData: PropertyListEncoder().encode(Set<ApplicationToken>()), protectedApplicationTokenData: nil, now: installedAt)
        let manifest = store.read(forKey: deviceActivityMonitorInstallationStorageKey)
        store.ignoreRemovals = true
        runtime.clearPolicy(activityId: "policy")
        XCTAssertEqual(store.read(forKey: deviceActivityMonitorInstallationStorageKey), manifest)
        XCTAssertEqual(store.read(forKey: "activeActivityId"), Data("policy".utf8))
        XCTAssertTrue(scheduler.stopped.isEmpty)
    }
    func testLostManifestReclaimsOnlyOwnedGeneratedMonitorNames() throws {
        let store = CallbackRuntimeBlobStore(), scheduler = CallbackRuntimeScheduler()
        scheduler.orphanIds = [monitor]
        let runtime = PCAProductionProtectionPolicyRuntime(authorizationIsApproved: { true }, scheduler: scheduler, blobStore: store, installationClock: { self.installedAt })
        _ = try runtime.applyVerifiedPolicy(scheduleData: boundaryPolicy(), applicationTokenData: PropertyListEncoder().encode(Set<ApplicationToken>()), protectedApplicationTokenData: nil, now: installedAt)
        XCTAssertEqual(scheduler.stopped, [monitor])
    }

}

private enum CallbackRuntimeFailure: Error { case injected }
private final class CallbackRuntimeBlobStore: OpaqueBlobStore {
    private var values: [String: Data] = [:]
    var ignoreRemovals = false
    var failNextActiveManifestVerification = false
    private var activeManifestVerificationFailurePending = false
    private(set) var activeManifestVerificationFailureCount = 0
    var failActiveWrite = false
    var failNextActiveMirrorWrite = false
    var failKey: String?
    var onWrite: ((String) -> Void)?
    func write(_ data: Data, forKey key: String) throws {
        onWrite?(key)
        if key == failKey || (failKey != nil && key.hasPrefix(failKey! + ".")) { throw CallbackRuntimeFailure.injected }
        if failNextActiveMirrorWrite && key == "activeActivityId" {
            failNextActiveMirrorWrite = false
            throw CallbackRuntimeFailure.injected
        }
        if failActiveWrite && key == deviceActivityMonitorInstallationStorageKey && DeviceActivityMonitorInstallation.decodeValidated(data)?.state == .active { throw CallbackRuntimeFailure.injected }
        values[key] = data
        if key == deviceActivityMonitorInstallationStorageKey &&
            DeviceActivityMonitorInstallation.decodeValidated(data)?.state == .active {
            if failNextActiveManifestVerification {
                failNextActiveManifestVerification = false
                activeManifestVerificationFailurePending = true
            }
        }
    }
    func read(forKey key: String) -> Data? {
        if key == deviceActivityMonitorInstallationStorageKey && activeManifestVerificationFailurePending {
            activeManifestVerificationFailurePending = false
            activeManifestVerificationFailureCount += 1
            return Data("verification mismatch".utf8)
        }
        return values[key]
    }
    func remove(forKey key: String) { if !ignoreRemovals { values.removeValue(forKey: key) } }
}
private final class CallbackRuntimeScheduler: PCADeviceActivityScheduler {
    var failStart = false
    var failAtStart: Int?
    var orphanIds: [String] = []
    var onStart: ((String, Calendar) -> Void)?
    var started: [String] = []
    var stopped: [String] = []
    var events: [String] = []
    func start(activityId: String, calendar: Calendar) throws {
        started.append(activityId)
        events.append("start:\(activityId)")
        if !orphanIds.contains(activityId) { orphanIds.append(activityId) }
        onStart?(activityId, calendar)
        if failStart || failAtStart == started.count { throw CallbackRuntimeFailure.injected }
    }
    func startBoundary(activityId: String, trigger: DeviceActivityBoundaryTrigger) throws {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        try start(activityId: activityId, calendar: calendar)
    }
    func ownedMonitorActivityIds() -> [String] { orphanIds }
    func stop(activityId: String) {
        stopped.append(activityId)
        events.append("stop:\(activityId)")
        orphanIds.removeAll { $0 == activityId }
    }
}
private final class CallbackRuntimeLog: CallbackObservationLog {
    var records: [PersistedCallbackObservation] = []
    func record(kind: DeviceActivityCallbackKind, activityId: String, at: Date) {}
    func readAll() -> [PersistedCallbackObservation] { records }
}
#endif
