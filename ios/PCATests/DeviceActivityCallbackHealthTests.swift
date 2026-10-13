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

    func testDeniedNotDeterminedAndUnknownAuthorizationClearShieldsAndPreservePolicy() {
        for status in [DeviceActivityCallbackAuthorization.denied, .notDetermined, .unavailable] {
            XCTAssertEqual(DeviceActivityAuthorizationGate.action(for: status), .clearShieldsPreservingPolicy,
                "\(status) must clear ManagedSettings without discarding stored policy")
        }
    }

    func testApprovedAuthorizationRunsCurrentPolicyDecisionWithoutClearing() {
        XCTAssertEqual(DeviceActivityAuthorizationGate.action(for: .approved), .applyCurrentPolicy)
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
    func testNonFiniteDatesCannotCertifyCallbackHealthOrCreateExpectations() {
        let validObservation = [receipt(base.addingTimeInterval(1))]
        let validExpectation = [firstStart()]
        let infiniteDate = Date(timeIntervalSince1970: .infinity)

        XCTAssertEqual(DeviceActivityCallbackReconciler.reconcile(
            expected: validExpectation, observed: validObservation, activityId: monitor,
            installationGeneration: generation, nowUtc: infiniteDate
        ), .unknown)
        XCTAssertEqual(DeviceActivityCallbackReconciler.reconcile(
            expected: [ExpectedCallback(kind: .intervalDidStart, occurrenceAt: infiniteDate,
                observationWindowEndsAt: infiniteDate, attributionIsUnambiguous: true)],
            observed: validObservation, activityId: monitor, installationGeneration: generation,
            nowUtc: base.addingTimeInterval(3600)
        ), .unknown)
        XCTAssertEqual(DeviceActivityCallbackReconciler.reconcile(
            expected: validExpectation,
            observed: [receipt(infiniteDate)], activityId: monitor,
            installationGeneration: generation, nowUtc: base.addingTimeInterval(3600)
        ), .unknown)
        XCTAssertTrue(DeviceActivityCallbackPlanner.expectedCallbacks(
            installedAt: base, now: infiniteDate, calendar: calendar()
        ).isEmpty)
        XCTAssertTrue(DeviceActivityCallbackPlanner.expectedCallbacks(
            installedAt: infiniteDate, now: base.addingTimeInterval(3600), calendar: calendar()
        ).isEmpty)
    }
    func testFiniteButUnpersistableDatesCannotCertifyHealthOrCreateExpectations() {
        let belowSupportedRange = Date(timeIntervalSince1970: -62_135_596_801)
        let aboveSupportedRange = Date(timeIntervalSince1970: 253_402_300_800)

        for invalidDate in [belowSupportedRange, aboveSupportedRange] {
            XCTAssertEqual(DeviceActivityCallbackReconciler.reconcile(
                expected: [ExpectedCallback(kind: .intervalDidStart, occurrenceAt: invalidDate,
                    observationWindowEndsAt: invalidDate.addingTimeInterval(86_400), attributionIsUnambiguous: true)],
                observed: [receipt(invalidDate)], activityId: monitor,
                installationGeneration: generation, nowUtc: invalidDate.addingTimeInterval(3_600)
            ), .unknown)
            XCTAssertTrue(DeviceActivityCallbackPlanner.expectedCallbacks(
                installedAt: invalidDate, now: invalidDate.addingTimeInterval(3_600), calendar: calendar()
            ).isEmpty)
            XCTAssertTrue(DeviceActivityCallbackPlanner.expectedCallbacks(
                installedAt: base, now: invalidDate, calendar: calendar()
            ).isEmpty)
        }
    }
    func testCallbackHealthAndPersistedBoundaryShareYearOneThrough9999Limits() {
        let legacyCap = Date(timeIntervalSince1970: 253_402_257_599)
        let year9999End = Date(timeIntervalSince1970: DeviceActivityTimestamp.maximumExclusiveUnixSeconds - 0.001)
        let belowMinimum = Date(timeIntervalSince1970: -62_135_596_801)
        let atExclusiveMaximum = Date(timeIntervalSince1970: DeviceActivityTimestamp.maximumExclusiveUnixSeconds)

        XCTAssertTrue(DeviceActivityTimestamp.isValid(legacyCap), "the existing cap remains inside the canonical range")
        XCTAssertTrue(DeviceActivityTimestamp.isValid(year9999End), "the final millisecond of year 9999 is supported")
        XCTAssertTrue(DeviceActivityBoundaryTrigger.absolute(utc: legacyCap).isValid)
        XCTAssertTrue(DeviceActivityBoundaryTrigger.absolute(utc: year9999End).isValid)
        XCTAssertFalse(DeviceActivityTimestamp.isValid(belowMinimum))
        XCTAssertFalse(DeviceActivityTimestamp.isValid(atExclusiveMaximum))
        XCTAssertFalse(DeviceActivityBoundaryTrigger.absolute(utc: belowMinimum).isValid)
        XCTAssertFalse(DeviceActivityBoundaryTrigger.absolute(utc: atExclusiveMaximum).isValid)

        for end in [legacyCap, year9999End] {
            let occurrence = end.addingTimeInterval(-1_200)
            let expected = [ExpectedCallback(kind: .intervalDidStart, occurrenceAt: occurrence,
                observationWindowEndsAt: end, attributionIsUnambiguous: true)]
            let observed = [receipt(occurrence.addingTimeInterval(1))]
            XCTAssertEqual(DeviceActivityCallbackReconciler.reconcile(
                expected: expected, observed: observed, activityId: monitor,
                installationGeneration: generation, nowUtc: end
            ), .healthy)
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

    private final class FailOnceCoordination: DeviceActivityPolicyCoordination {
        private let lock = NSLock()
        private var shouldFail = true

        func withExclusiveAccess<T>(_ operation: () throws -> T) throws -> T {
            lock.lock()
            defer { lock.unlock() }
            if shouldFail {
                shouldFail = false
                throw CallbackRuntimeFailure.injected
            }
            return try operation()
        }
    }

    private final class ShieldRecorder: PCADeviceActivityShieldEnforcing {
        var applyCount = 0
        var removeCount = 0
        var failNextApply = false
        var applyFailuresRemaining = 0
        func apply(applications: Set<ApplicationToken>, protectedApplications: Set<ApplicationToken>) throws {
            applyCount += 1
            if failNextApply || applyFailuresRemaining > 0 {
                failNextApply = false
                applyFailuresRemaining = max(0, applyFailuresRemaining - 1)
                throw CallbackRuntimeFailure.injected
            }
        }
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

    func testEveryAcceptedActivityIdLengthCanBeCleared() throws {
        let activityIds = [
            String(repeating: "p", count: 129),
            String(repeating: "p", count: 256),
            String(repeating: "é", count: 128), // 256 UTF-8 bytes
        ]
        for activityId in activityIds {
            let store = CallbackRuntimeBlobStore()
            let scheduler = CallbackRuntimeScheduler()
            let shields = ShieldRecorder()
            let runtime = PCAProductionProtectionPolicyRuntime(authorizationIsApproved: { true },
                scheduler: scheduler, blobStore: store,
                installationClock: { self.installedAt }, shieldEnforcer: shields)

            _ = try runtime.applyVerifiedPolicy(scheduleData: policy(activityId),
                applicationTokenData: PropertyListEncoder().encode(Set<ApplicationToken>()),
                protectedApplicationTokenData: nil, now: installedAt)
            let active = try XCTUnwrap(DeviceActivityMonitorInstallation.decodeValidated(
                try XCTUnwrap(store.read(forKey: deviceActivityMonitorInstallationStorageKey))))
            XCTAssertEqual(active.policyActivityId.utf8.count, activityId.utf8.count)

            let removalsBeforeClear = shields.removeCount
            runtime.clearPolicy(activityId: activityId)

            XCTAssertNil(store.read(forKey: deviceActivityMonitorInstallationStorageKey),
                "clear recovery bounds must not be narrower than accepted policy identity bounds")
            XCTAssertNil(store.read(forKey: "activeActivityId"))
            XCTAssertNil(store.read(forKey: "schedule.\(activityId).\(active.generation)"))
            XCTAssertTrue(Set(active.allMonitorActivityIds).isSubset(of: Set(scheduler.stopped)))
            XCTAssertEqual(shields.removeCount, removalsBeforeClear + 1,
                "clear removes shields once after policy application")
        }
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

    func testRuntimeRestartResumesPendingUsageActivationAfterManifestCommit() throws {
        struct Token: Hashable, Codable { let value: String }
        struct PendingUsage: Codable {
            let plan: DeviceActivityUsageDayPlan
            let minutes: Int
        }

        let store = CallbackRuntimeBlobStore()
        let scheduler = CallbackRuntimeScheduler()
        let zone = TimeZone(identifier: "UTC")!
        let token = Token(value: "opaque-token")
        let binding = DeviceActivityUsageSelectionBinding(logicalAppToken: "opaque",
            applicationTokenData: try PropertyListEncoder().encode(token))
        let dailyPolicy = DecodedSchedulePolicy(activityId: "policy", appToken: "opaque",
            timeZone: zone, windows: [], bonusGrants: [], exceptions: [],
            dailyLimit: DailyAppLimit(appScope: .all, limitMinutes: 60, usedMinutesToday: 0,
                anchorLocalDate: "2000-01-01"), enforcementCapability: .enforced)
        let plan = try DeviceActivityUsagePlanner.plan(policy: dailyPolicy, binding: binding,
            generation: UUID().uuidString.lowercased(), now: installedAt, deviceTimeZone: zone,
            historicalActivitySupported: true, otherMonitorCount: 1)
        let installation = DeviceActivityMonitorInstallation(policyActivityId: "policy",
            monitorActivityId: "pca-monitor-33333333-3333-4333-8333-333333333333",
            generation: plan.generation, installedAtUtc: installedAt, timeZoneIdentifier: "UTC",
            state: .active, schemaVersion: 3, boundaryMonitors: [], usageDayPlan: plan)
        let manifestData = try JSONEncoder().encode(installation)
        try store.write(manifestData, forKey: deviceActivityMonitorInstallationStorageKey)
        try store.write(Data("policy".utf8), forKey: "activeActivityId")
        try store.write(policy("policy", capability: .unavailable, restrictive: true),
            forKey: "schedule.policy." + plan.generation)
        let emptyTokens = try PropertyListEncoder().encode(Set<ApplicationToken>())
        try store.write(emptyTokens, forKey: "applicationTokens.policy." + plan.generation)
        try store.write(emptyTokens, forKey: "protectedApplicationTokens." + plan.generation)
        let stagedMinutes = try XCTUnwrap(plan.thresholds.first?.minutes)
        try store.write(JSONEncoder().encode(PendingUsage(plan: plan, minutes: stagedMinutes)),
            forKey: "usage.pending." + plan.generation)
        scheduler.orphanIds = installation.allMonitorActivityIds

        var activationCalls: [DeviceActivityUsageDayPlan] = []
        let shields = ShieldRecorder()
        let restored = PCAProductionProtectionPolicyRuntime(authorizationIsApproved: { true },
            scheduler: scheduler, blobStore: store, installationClock: { self.installedAt },
            shieldEnforcer: shields,
            pendingUsageActivator: { recoveredPlan in
                activationCalls.append(recoveredPlan)
                try DeviceActivityUsageLowerBoundStore<Token>(store: store).activate(plan: recoveredPlan)
            })

        XCTAssertEqual(activationCalls, [plan],
            "a fresh runtime must retry pending usage activation for the committed active manifest")
        XCTAssertEqual(store.read(forKey: deviceActivityMonitorInstallationStorageKey), manifestData,
            "recovery must preserve the committed manifest")
        XCTAssertEqual(store.read(forKey: "activeActivityId"), Data("policy".utf8))
        XCTAssertNil(store.read(forKey: "usage.pending." + plan.generation),
            "successful restart activation consumes the staged record only after its durable merge")
        XCTAssertEqual(try DeviceActivityUsageLowerBoundStore<Token>(store: store).lowerBound(for: plan), stagedMinutes)
        XCTAssertTrue(Set(installation.allMonitorActivityIds).isDisjoint(with: Set(scheduler.stopped)))
        XCTAssertGreaterThan(shields.applyCount + shields.removeCount, 0)
        XCTAssertEqual(restored.callbackHealth(now: installedAt), .unknown,
            "missing callback evidence remains unknown despite usage recovery")
    }

    func testRuntimeRestartPreservesPendingUsageAndRetriesActivationFailure() throws {
        struct Token: Hashable, Codable { let value: String }
        struct PendingUsage: Codable {
            let plan: DeviceActivityUsageDayPlan
            let minutes: Int
        }

        let store = CallbackRuntimeBlobStore()
        let scheduler = CallbackRuntimeScheduler()
        let log = CallbackRuntimeLog()
        let zone = TimeZone(identifier: "UTC")!
        let token = Token(value: "opaque-token")
        let binding = DeviceActivityUsageSelectionBinding(logicalAppToken: "opaque",
            applicationTokenData: try PropertyListEncoder().encode(token))
        let dailyPolicy = DecodedSchedulePolicy(activityId: "policy", appToken: "opaque",
            timeZone: zone, windows: [], bonusGrants: [], exceptions: [],
            dailyLimit: DailyAppLimit(appScope: .all, limitMinutes: 60, usedMinutesToday: 0,
                anchorLocalDate: "2000-01-01"), enforcementCapability: .enforced)
        let plan = try DeviceActivityUsagePlanner.plan(policy: dailyPolicy, binding: binding,
            generation: UUID().uuidString.lowercased(), now: installedAt, deviceTimeZone: zone,
            historicalActivitySupported: true, otherMonitorCount: 1)
        let monitorId = "pca-monitor-44444444-4444-4444-8444-444444444444"
        let installation = DeviceActivityMonitorInstallation(policyActivityId: "policy",
            monitorActivityId: monitorId, generation: plan.generation, installedAtUtc: installedAt,
            timeZoneIdentifier: "UTC", state: .active, schemaVersion: 3,
            boundaryMonitors: [], usageDayPlan: plan)
        let manifestData = try JSONEncoder().encode(installation)
        try store.write(manifestData, forKey: deviceActivityMonitorInstallationStorageKey)
        try store.write(Data("policy".utf8), forKey: "activeActivityId")
        try store.write(policy("policy", capability: .unavailable, restrictive: true),
            forKey: "schedule.policy." + plan.generation)
        let emptyTokens = try PropertyListEncoder().encode(Set<ApplicationToken>())
        try store.write(emptyTokens, forKey: "applicationTokens.policy." + plan.generation)
        try store.write(emptyTokens, forKey: "protectedApplicationTokens." + plan.generation)
        let stagedMinutes = try XCTUnwrap(plan.thresholds.first?.minutes)
        let pendingKey = "usage.pending." + plan.generation
        let pendingData = try JSONEncoder().encode(PendingUsage(plan: plan, minutes: stagedMinutes))
        try store.write(pendingData, forKey: pendingKey)
        store.failKey = "com.pca.app.deviceactivity.usage-lower-bound.v1"
        scheduler.orphanIds = installation.allMonitorActivityIds
        let shields = ShieldRecorder()
        log.records = [PersistedCallbackObservation(kind: .intervalDidStart, activityId: monitorId,
            installationGeneration: installation.generation,
            observedAtUtc: installedAt.addingTimeInterval(1), sequence: 1)]

        let restarted = PCAProductionProtectionPolicyRuntime(authorizationIsApproved: { true },
            scheduler: scheduler, blobStore: store, callbackLog: log,
            installationClock: { self.installedAt }, shieldEnforcer: shields,
            pendingUsageActivator: { recoveredPlan in
                try DeviceActivityUsageLowerBoundStore<Token>(store: store).activate(plan: recoveredPlan)
            })

        XCTAssertEqual(store.read(forKey: pendingKey), pendingData,
            "failed lower-bound persistence must preserve the staged callback aggregate")
        XCTAssertNil(try DeviceActivityUsageLowerBoundStore<Token>(store: store).lowerBound(for: plan))
        XCTAssertEqual(store.read(forKey: deviceActivityMonitorInstallationStorageKey), manifestData)
        XCTAssertEqual(restarted.callbackHealth(now: installedAt.addingTimeInterval(180)), .enforcementUnavailable,
            "callback evidence cannot hide a failed usage activation")

        store.failKey = nil
        XCTAssertEqual(restarted.callbackHealth(now: installedAt.addingTimeInterval(180)), .healthy,
            "health recovers only after the staged usage aggregate and enforcement are durably restored")
        XCTAssertNil(store.read(forKey: pendingKey))
        XCTAssertEqual(try DeviceActivityUsageLowerBoundStore<Token>(store: store).lowerBound(for: plan), stagedMinutes)
        XCTAssertGreaterThan(shields.applyCount + shields.removeCount, 0)
        XCTAssertEqual(store.read(forKey: deviceActivityMonitorInstallationStorageKey), manifestData,
            "recovery preserves the committed manifest")
    }

    func testRuntimeRestartDefersRecoveryAfterCoordinationLockFailureUntilHealthRetry() throws {
        let store = CallbackRuntimeBlobStore()
        let scheduler = CallbackRuntimeScheduler()
        let log = CallbackRuntimeLog()
        let writer = PCAProductionProtectionPolicyRuntime(authorizationIsApproved: { true },
            scheduler: scheduler, blobStore: store, callbackLog: log,
            installationClock: { self.installedAt })
        _ = try writer.applyVerifiedPolicy(scheduleData: policy("locked", capability: .unavailable, restrictive: true),
            applicationTokenData: PropertyListEncoder().encode(Set<ApplicationToken>()),
            protectedApplicationTokenData: nil, now: installedAt)
        let startedCountBeforeRestart = scheduler.started.count
        let installation = try XCTUnwrap(DeviceActivityMonitorInstallation.decodeValidated(
            try XCTUnwrap(store.read(forKey: deviceActivityMonitorInstallationStorageKey))))
        scheduler.orphanIds.removeAll { $0 == installation.monitorActivityId }
        log.records = [PersistedCallbackObservation(kind: .intervalDidStart,
            activityId: installation.monitorActivityId, installationGeneration: installation.generation,
            observedAtUtc: installedAt.addingTimeInterval(1), sequence: 1)]
        let shields = ShieldRecorder()

        let restarted = PCAProductionProtectionPolicyRuntime(authorizationIsApproved: { true },
            scheduler: scheduler, blobStore: store, callbackLog: log,
            installationClock: { self.installedAt }, policyCoordination: FailOnceCoordination(),
            shieldEnforcer: shields)

        XCTAssertEqual(scheduler.started.count, startedCountBeforeRestart,
            "the failed startup lock attempt must defer monitor registration")
        XCTAssertEqual(restarted.callbackHealth(now: installedAt.addingTimeInterval(180)), .healthy)
        XCTAssertGreaterThan(scheduler.started.count, startedCountBeforeRestart,
            "health retry restores a committed monitor after startup could not acquire coordination")
        XCTAssertGreaterThan(shields.applyCount + shields.removeCount, 0,
            "health is available only after enforcement reconciliation completes")
    }

    func testRuntimeRestartRetriesAuthorizationDeferredRecoveryBeforeReportingHealth() throws {
        let store = CallbackRuntimeBlobStore()
        let scheduler = CallbackRuntimeScheduler()
        let log = CallbackRuntimeLog()
        let writer = PCAProductionProtectionPolicyRuntime(authorizationIsApproved: { true },
            scheduler: scheduler, blobStore: store, callbackLog: log,
            installationClock: { self.installedAt })
        _ = try writer.applyVerifiedPolicy(scheduleData: policy("authorization", capability: .unavailable, restrictive: true),
            applicationTokenData: PropertyListEncoder().encode(Set<ApplicationToken>()),
            protectedApplicationTokenData: nil, now: installedAt)
        let startedCountBeforeRestart = scheduler.started.count
        let installation = try XCTUnwrap(DeviceActivityMonitorInstallation.decodeValidated(
            try XCTUnwrap(store.read(forKey: deviceActivityMonitorInstallationStorageKey))))
        scheduler.orphanIds.removeAll { $0 == installation.monitorActivityId }
        log.records = [PersistedCallbackObservation(kind: .intervalDidStart,
            activityId: installation.monitorActivityId, installationGeneration: installation.generation,
            observedAtUtc: installedAt.addingTimeInterval(1), sequence: 1)]
        var authorized = false
        let shields = ShieldRecorder()
        let restarted = PCAProductionProtectionPolicyRuntime(authorizationIsApproved: { authorized },
            scheduler: scheduler, blobStore: store, callbackLog: log,
            installationClock: { self.installedAt }, shieldEnforcer: shields)

        XCTAssertEqual(scheduler.started.count, startedCountBeforeRestart,
            "startup recovery must not register monitors without authorization")
        XCTAssertEqual(restarted.callbackHealth(now: installedAt.addingTimeInterval(180)), .enforcementUnavailable,
            "callback receipts cannot certify health while required recovery is unauthorized")
        XCTAssertEqual(scheduler.started.count, startedCountBeforeRestart,
            "an unauthorized health check must also leave monitor state untouched")

        authorized = true
        XCTAssertEqual(restarted.callbackHealth(now: installedAt.addingTimeInterval(180)), .healthy)
        XCTAssertGreaterThan(scheduler.started.count, startedCountBeforeRestart,
            "authorized health retry must re-register the missing monitor")
        XCTAssertGreaterThan(shields.applyCount + shields.removeCount, 0)
    }

    func testRevokedAuthorizationAtStartupClearsShieldsAndPreservesExactPolicyForRecovery() throws {
        let store = CallbackRuntimeBlobStore()
        let scheduler = CallbackRuntimeScheduler()
        let log = CallbackRuntimeLog()
        let shields = ShieldRecorder()
        let policyData = try policy("startup-revoked", capability: .unavailable, restrictive: true)
        let tokens = try PropertyListEncoder().encode(Set<ApplicationToken>())
        let writer = PCAProductionProtectionPolicyRuntime(authorizationIsApproved: { true },
            scheduler: scheduler, blobStore: store, callbackLog: log,
            installationClock: { self.installedAt }, shieldEnforcer: shields)
        _ = try writer.applyVerifiedPolicy(scheduleData: policyData,
            applicationTokenData: tokens, protectedApplicationTokenData: nil, now: installedAt)
        let manifestData = try XCTUnwrap(store.read(forKey: deviceActivityMonitorInstallationStorageKey))
        let installation = try XCTUnwrap(DeviceActivityMonitorInstallation.decodeValidated(manifestData))
        let payloadSuffix = installation.payloadStorageGeneration.map { "." + $0 } ?? ""
        let payloadKey = "schedule.\(installation.policyActivityId)\(payloadSuffix)"
        let storedPolicy = try XCTUnwrap(store.read(forKey: payloadKey))
        log.records = [PersistedCallbackObservation(kind: .intervalDidStart,
            activityId: installation.monitorActivityId, installationGeneration: installation.generation,
            observedAtUtc: installedAt.addingTimeInterval(1), sequence: 1)]
        let startsBeforeRestart = scheduler.started.count
        let removalsBeforeRestart = shields.removeCount
        var authorized = false

        let restarted = PCAProductionProtectionPolicyRuntime(authorizationIsApproved: { authorized },
            scheduler: scheduler, blobStore: store, callbackLog: log,
            installationClock: { self.installedAt }, shieldEnforcer: shields)

        XCTAssertEqual(shields.removeCount, removalsBeforeRestart + 1,
            "startup with a committed policy but revoked authorization must clear stale shields")
        XCTAssertEqual(restarted.callbackHealth(now: installedAt.addingTimeInterval(180)), .enforcementUnavailable)
        XCTAssertEqual(scheduler.started.count, startsBeforeRestart,
            "revoked startup must defer monitor and enforcement recovery")
        XCTAssertEqual(store.read(forKey: deviceActivityMonitorInstallationStorageKey), manifestData,
            "clearing current shields must not discard the exact active manifest")
        XCTAssertEqual(store.read(forKey: payloadKey), storedPolicy,
            "policy payload must remain available for exact-generation recovery")

        authorized = true
        XCTAssertEqual(restarted.callbackHealth(now: installedAt.addingTimeInterval(180)), .healthy)
        XCTAssertGreaterThan(shields.applyCount, 0,
            "approved recovery must reapply the stored active policy")
        XCTAssertEqual(store.read(forKey: deviceActivityMonitorInstallationStorageKey), manifestData)
        XCTAssertEqual(store.read(forKey: payloadKey), storedPolicy)
    }

    func testLifecycleReconciliationReappliesCommittedPolicyWithoutAdvancingGeneration() throws {
        let store = CallbackRuntimeBlobStore()
        let scheduler = CallbackRuntimeScheduler()
        let shields = ShieldRecorder()
        let runtime = PCAProductionProtectionPolicyRuntime(authorizationIsApproved: { true },
            scheduler: scheduler, blobStore: store, installationClock: { self.installedAt },
            shieldEnforcer: shields)
        let tokens = try PropertyListEncoder().encode(Set<ApplicationToken>())
        XCTAssertEqual(try runtime.applyVerifiedPolicy(
            scheduleData: policy("lifecycle-reconcile", capability: .enforced, restrictive: true),
            applicationTokenData: tokens, protectedApplicationTokenData: nil, now: installedAt), .applied)
        let manifestBefore = try XCTUnwrap(store.read(forKey: deviceActivityMonitorInstallationStorageKey))
        let installation = try XCTUnwrap(DeviceActivityMonitorInstallation.decodeValidated(manifestBefore))
        let monitorCountBefore = scheduler.started.count
        let applyCountBefore = shields.applyCount

        // Simulate the OS clearing process-local enforcement while retaining
        // the committed installation and its callback generation.
        shields.removeAll()
        let result = try runtime.reconcileInstalledPolicy(now: installedAt.addingTimeInterval(60))

        XCTAssertEqual(result, .applied)
        XCTAssertEqual(shields.applyCount, applyCountBefore + 1,
            "foreground/background wake re-evaluates the persisted policy and reapplies its current decision")
        XCTAssertEqual(scheduler.started.count, monitorCountBefore,
            "an intact committed monitor set is not needlessly replaced")
        XCTAssertEqual(store.read(forKey: deviceActivityMonitorInstallationStorageKey), manifestBefore,
            "lifecycle recovery must not advance or relabel signed policy authority")
        XCTAssertEqual(DeviceActivityMonitorInstallation.decodeValidated(
            try XCTUnwrap(store.read(forKey: deviceActivityMonitorInstallationStorageKey))), installation)
    }

    func testAuthorizationRevocationInvalidatesRecentHealthAndRequiresReconciliationAfterRestore() throws {
        let store = CallbackRuntimeBlobStore()
        let scheduler = CallbackRuntimeScheduler()
        let log = CallbackRuntimeLog()
        let shields = ShieldRecorder()
        var authorized = true
        let runtime = PCAProductionProtectionPolicyRuntime(authorizationIsApproved: { authorized },
            scheduler: scheduler, blobStore: store, callbackLog: log,
            installationClock: { self.installedAt }, shieldEnforcer: shields)
        XCTAssertEqual(try runtime.applyVerifiedPolicy(
            scheduleData: policy("authorization-revoked", capability: .unavailable, restrictive: true),
            applicationTokenData: PropertyListEncoder().encode(Set<ApplicationToken>()),
            protectedApplicationTokenData: nil, now: installedAt), .degraded)
        let manifestData = try XCTUnwrap(store.read(forKey: deviceActivityMonitorInstallationStorageKey))
        let installation = try XCTUnwrap(DeviceActivityMonitorInstallation.decodeValidated(manifestData))
        let payloadSuffix = installation.payloadStorageGeneration.map { "." + $0 } ?? ""
        let payloadKey = "schedule.\(installation.policyActivityId)\(payloadSuffix)"
        let storedPolicy = try XCTUnwrap(store.read(forKey: payloadKey))
        log.records = [PersistedCallbackObservation(kind: .intervalDidStart,
            activityId: installation.monitorActivityId, installationGeneration: installation.generation,
            observedAtUtc: installedAt.addingTimeInterval(1), sequence: 1)]
        let healthyAt = installedAt.addingTimeInterval(180)
        XCTAssertEqual(runtime.callbackHealth(now: healthyAt), .healthy)

        authorized = false
        let startsBeforeRevocationCheck = scheduler.started.count
        let appliesBeforeRevocationCheck = shields.applyCount
        let removalsBeforeRevocationCheck = shields.removeCount
        XCTAssertEqual(runtime.callbackHealth(now: healthyAt), .enforcementUnavailable,
            "recent callbacks cannot certify enforcement after Screen Time approval is revoked")
        XCTAssertEqual(scheduler.started.count, startsBeforeRevocationCheck,
            "an unauthorized runtime must not register monitors")
        XCTAssertEqual(shields.applyCount, appliesBeforeRevocationCheck,
            "an unauthorized runtime must not reapply restrictions")
        XCTAssertEqual(shields.removeCount, removalsBeforeRevocationCheck + 1,
            "observed authorization loss clears stale shields while preserving the policy generation")
        XCTAssertEqual(store.read(forKey: deviceActivityMonitorInstallationStorageKey), manifestData)
        XCTAssertEqual(store.read(forKey: payloadKey), storedPolicy)

        authorized = true
        XCTAssertEqual(runtime.callbackHealth(now: healthyAt), .healthy,
            "restored approval must reconcile the exact active generation before health recovers")
        XCTAssertGreaterThan(shields.applyCount, appliesBeforeRevocationCheck,
            "restored approval must reapply committed protection settings")
        XCTAssertEqual(store.read(forKey: deviceActivityMonitorInstallationStorageKey), manifestData)
        XCTAssertEqual(store.read(forKey: payloadKey), storedPolicy)
        XCTAssertEqual(DeviceActivityMonitorInstallation.decodeValidated(
            try XCTUnwrap(store.read(forKey: deviceActivityMonitorInstallationStorageKey))), installation)
    }

    func testUnauthorizedApplyClearsShieldsAndPreservesActiveGenerationForRecovery() throws {
        let store = CallbackRuntimeBlobStore()
        let scheduler = CallbackRuntimeScheduler()
        let shields = ShieldRecorder()
        var authorized = true
        let runtime = PCAProductionProtectionPolicyRuntime(authorizationIsApproved: { authorized },
            scheduler: scheduler, blobStore: store, installationClock: { self.installedAt },
            shieldEnforcer: shields)
        let originalPolicy = try policy("apply-revoked", capability: .unavailable, restrictive: true)
        let tokens = try PropertyListEncoder().encode(Set<ApplicationToken>())
        _ = try runtime.applyVerifiedPolicy(scheduleData: originalPolicy,
            applicationTokenData: tokens, protectedApplicationTokenData: nil, now: installedAt)
        let manifestData = try XCTUnwrap(store.read(forKey: deviceActivityMonitorInstallationStorageKey))
        let installation = try XCTUnwrap(DeviceActivityMonitorInstallation.decodeValidated(manifestData))
        let payloadSuffix = installation.payloadStorageGeneration.map { "." + $0 } ?? ""
        let payloadKey = "schedule.\(installation.policyActivityId)\(payloadSuffix)"
        let storedPolicy = try XCTUnwrap(store.read(forKey: payloadKey))
        let applyCountBeforeRevocation = shields.applyCount
        let removeCountBeforeRevocation = shields.removeCount

        authorized = false
        XCTAssertThrowsError(try runtime.applyVerifiedPolicy(
            scheduleData: policy("replacement-after-revocation", capability: .unavailable, restrictive: true),
            applicationTokenData: tokens, protectedApplicationTokenData: nil, now: installedAt)) {
            XCTAssertEqual($0 as? PCAProtectionPolicyApplicationError, .authorizationRequired)
        }
        XCTAssertEqual(shields.applyCount, applyCountBeforeRevocation)
        XCTAssertEqual(shields.removeCount, removeCountBeforeRevocation + 1)
        XCTAssertEqual(store.read(forKey: deviceActivityMonitorInstallationStorageKey), manifestData)
        XCTAssertEqual(store.read(forKey: payloadKey), storedPolicy,
            "denied replacement cannot overwrite the durable generation needed for recovery")

        authorized = true
        _ = runtime.callbackHealth(now: installedAt.addingTimeInterval(180))
        XCTAssertGreaterThan(shields.applyCount, applyCountBeforeRevocation,
            "restoring authorization replays enforcement from the committed generation")
        XCTAssertEqual(store.read(forKey: deviceActivityMonitorInstallationStorageKey), manifestData)
        XCTAssertEqual(store.read(forKey: payloadKey), storedPolicy)
    }

    func testAuthorizationRevokedDuringMonitorRegistrationCannotReachManagedSettings() throws {
        let store = CallbackRuntimeBlobStore()
        let scheduler = CallbackRuntimeScheduler()
        let shields = ShieldRecorder()
        var authorized = true
        scheduler.onStart = { _, _ in authorized = false }
        let policyData = try policy("revoked-during-registration", capability: .unavailable, restrictive: true)
        let tokens = try PropertyListEncoder().encode(Set<ApplicationToken>())
        let runtime = PCAProductionProtectionPolicyRuntime(authorizationIsApproved: { authorized },
            scheduler: scheduler, blobStore: store, callbackLog: CallbackRuntimeLog(),
            installationClock: { self.installedAt }, shieldEnforcer: shields)

        XCTAssertThrowsError(try runtime.applyVerifiedPolicy(scheduleData: policyData,
            applicationTokenData: tokens, protectedApplicationTokenData: nil, now: installedAt)) {
            XCTAssertEqual($0 as? PCAProtectionPolicyApplicationError, .authorizationRequired)
        }

        let manifestData = try XCTUnwrap(store.read(forKey: deviceActivityMonitorInstallationStorageKey))
        let installation = try XCTUnwrap(DeviceActivityMonitorInstallation.decodeValidated(manifestData))
        XCTAssertEqual(installation.state, .active,
            "the committed generation remains the exact recovery source after mid-apply revocation")
        XCTAssertEqual(store.read(forKey: "schedule.\(installation.policyActivityId).\(installation.generation)"), policyData)
        XCTAssertEqual(shields.applyCount, 0,
            "no ManagedSettings restriction write may occur after registration observes revocation")
        XCTAssertEqual(shields.removeCount, 1,
            "stale restrictions are cleared at the final authorization boundary")
        XCTAssertTrue(Set(installation.allMonitorActivityIds).isSubset(of: Set(scheduler.stopped)),
            "monitors staged under the old authorization state must stop until authorized recovery")

        let appliesBeforeRecovery = shields.applyCount
        authorized = true
        scheduler.onStart = { _, _ in authorized = false }
        XCTAssertEqual(runtime.callbackHealth(now: installedAt.addingTimeInterval(180)), .enforcementUnavailable,
            "authorization lost during monitor restoration cannot reach the enforcement replay")
        XCTAssertEqual(shields.applyCount, appliesBeforeRecovery)
        XCTAssertEqual(shields.removeCount, 2,
            "a second revocation during recovery also clears restrictions")
        XCTAssertTrue(Set(installation.allMonitorActivityIds).isSubset(of: Set(scheduler.stopped)))

        authorized = true
        scheduler.onStart = nil
        _ = runtime.callbackHealth(now: installedAt.addingTimeInterval(180))
        XCTAssertGreaterThan(shields.applyCount, appliesBeforeRecovery,
            "restored approval replays enforcement from the retained active generation")
        XCTAssertEqual(store.read(forKey: deviceActivityMonitorInstallationStorageKey), manifestData)
    }

    func testRuntimeRestartReappliesCommittedFirstInstallAfterSettingsFailure() throws {
        let store = CallbackRuntimeBlobStore()
        let scheduler = CallbackRuntimeScheduler()
        let shields = ShieldRecorder()
        shields.failNextApply = true
        let tokens = try PropertyListEncoder().encode(Set<ApplicationToken>())
        let data = try policy("first", capability: .unavailable, restrictive: true)
        let runtime = PCAProductionProtectionPolicyRuntime(authorizationIsApproved: { true },
            scheduler: scheduler, blobStore: store, installationClock: { self.installedAt },
            shieldEnforcer: shields, pendingUsageActivator: { _ in })

        XCTAssertThrowsError(try runtime.applyVerifiedPolicy(scheduleData: data,
            applicationTokenData: tokens, protectedApplicationTokenData: nil, now: installedAt))
        let committed = try XCTUnwrap(DeviceActivityMonitorInstallation.decodeValidated(
            try XCTUnwrap(store.read(forKey: deviceActivityMonitorInstallationStorageKey))))
        XCTAssertEqual(committed.state, .active, "policy publication commits before settings restoration")
        XCTAssertEqual(shields.applyCount, 1, "the first settings write is interrupted")

        _ = PCAProductionProtectionPolicyRuntime(authorizationIsApproved: { true },
            scheduler: scheduler, blobStore: store, installationClock: { self.installedAt },
            shieldEnforcer: shields, pendingUsageActivator: { _ in })

        XCTAssertEqual(shields.applyCount, 2,
            "relaunch must idempotently replay the currently committed enforcement decision")
        XCTAssertEqual(shields.removeCount, 0,
            "authorized startup must restore enforcement without first clearing its shields")
        let committedSuffix = committed.payloadStorageGeneration.map { "." + $0 } ?? ""
        XCTAssertEqual(store.read(forKey: "schedule.first\(committedSuffix)"), data)
        XCTAssertEqual(DeviceActivityMonitorInstallation.decodeValidated(
            try XCTUnwrap(store.read(forKey: deviceActivityMonitorInstallationStorageKey))), committed)
    }

    func testRuntimeRestartReconcilesOnlySupersedingCommittedPolicy() throws {
        let store = CallbackRuntimeBlobStore()
        let scheduler = CallbackRuntimeScheduler()
        let shields = ShieldRecorder()
        let tokens = try PropertyListEncoder().encode(Set<ApplicationToken>())
        let runtime = PCAProductionProtectionPolicyRuntime(authorizationIsApproved: { true },
            scheduler: scheduler, blobStore: store, installationClock: { self.installedAt },
            shieldEnforcer: shields, pendingUsageActivator: { _ in })

        XCTAssertEqual(try runtime.applyVerifiedPolicy(scheduleData: policy("previous", capability: .unavailable, restrictive: true),
            applicationTokenData: tokens, protectedApplicationTokenData: nil, now: installedAt), .degraded)
        let previous = try XCTUnwrap(DeviceActivityMonitorInstallation.decodeValidated(
            try XCTUnwrap(store.read(forKey: deviceActivityMonitorInstallationStorageKey))))
        let currentPolicy = try policy("current", capability: .unavailable, restrictive: true)
        shields.failNextApply = true
        XCTAssertThrowsError(try runtime.applyVerifiedPolicy(scheduleData: currentPolicy,
            applicationTokenData: tokens, protectedApplicationTokenData: nil, now: installedAt))
        let current = try XCTUnwrap(DeviceActivityMonitorInstallation.decodeValidated(
            try XCTUnwrap(store.read(forKey: deviceActivityMonitorInstallationStorageKey))))
        XCTAssertNotEqual(current.generation, previous.generation)
        XCTAssertEqual(current.policyActivityId, "current")

        _ = PCAProductionProtectionPolicyRuntime(authorizationIsApproved: { true },
            scheduler: scheduler, blobStore: store, installationClock: { self.installedAt },
            shieldEnforcer: shields, pendingUsageActivator: { _ in })

        XCTAssertEqual(shields.applyCount, 3,
            "initial policy, interrupted replacement, and restart replay each apply exactly once")
        let previousSuffix = previous.payloadStorageGeneration.map { "." + $0 } ?? ""
        let currentSuffix = current.payloadStorageGeneration.map { "." + $0 } ?? ""
        XCTAssertNil(store.read(forKey: "schedule.previous\(previousSuffix)"),
            "superseded generation must remain retired")
        XCTAssertEqual(store.read(forKey: "schedule.current\(currentSuffix)"), currentPolicy,
            "restart must preserve the exact committed policy bytes, not merely a semantically re-encoded value")
        XCTAssertEqual(DeviceActivityMonitorInstallation.decodeValidated(
            try XCTUnwrap(store.read(forKey: deviceActivityMonitorInstallationStorageKey))), current)
    }

    func testRuntimeRestartDoesNotApplyWhenCommittedGenerationFloorIsMissing() throws {
        let store = CallbackRuntimeBlobStore()
        let scheduler = CallbackRuntimeScheduler()
        let tokens = try PropertyListEncoder().encode(Set<ApplicationToken>())
        let initialShields = ShieldRecorder()
        let runtime = PCAProductionProtectionPolicyRuntime(authorizationIsApproved: { true },
            scheduler: scheduler, blobStore: store, installationClock: { self.installedAt },
            shieldEnforcer: initialShields, pendingUsageActivator: { _ in })
        XCTAssertEqual(try runtime.applyVerifiedPolicy(scheduleData: policy("current", capability: .unavailable,
            restrictive: true), applicationTokenData: tokens, protectedApplicationTokenData: nil,
            now: installedAt), .degraded)
        let committedData = try XCTUnwrap(store.read(forKey: deviceActivityMonitorInstallationStorageKey))
        let committed = try XCTUnwrap(DeviceActivityMonitorInstallation.decodeValidated(committedData))
        let suffix = committed.payloadStorageGeneration.map { "." + $0 } ?? ""
        store.remove(forKey: "protectedApplicationTokens\(suffix)")

        let restartShields = ShieldRecorder()
        _ = PCAProductionProtectionPolicyRuntime(authorizationIsApproved: { true },
            scheduler: scheduler, blobStore: store, installationClock: { self.installedAt },
            shieldEnforcer: restartShields, pendingUsageActivator: { _ in })

        XCTAssertEqual(restartShields.applyCount, 0)
        XCTAssertEqual(restartShields.removeCount, 0,
            "missing generation-bound floor must not be interpreted as an empty floor or permissive policy")
        XCTAssertEqual(store.read(forKey: deviceActivityMonitorInstallationStorageKey), committedData,
            "failed recovery preserves the committed manifest for diagnosis and retry")
    }

    func testStartupSettingsFailureRemainsDegradedUntilExactGenerationRetrySucceeds() throws {
        let store = CallbackRuntimeBlobStore()
        let scheduler = CallbackRuntimeScheduler()
        let log = CallbackRuntimeLog()
        let initialShields = ShieldRecorder()
        let tokens = try PropertyListEncoder().encode(Set<ApplicationToken>())
        let initialRuntime = PCAProductionProtectionPolicyRuntime(authorizationIsApproved: { true },
            scheduler: scheduler, blobStore: store, callbackLog: log,
            installationClock: { self.installedAt }, shieldEnforcer: initialShields,
            pendingUsageActivator: { _ in })
        XCTAssertEqual(try initialRuntime.applyVerifiedPolicy(
            scheduleData: policy("current", capability: .unavailable, restrictive: true),
            applicationTokenData: tokens, protectedApplicationTokenData: nil, now: installedAt), .degraded)
        let installation = try XCTUnwrap(DeviceActivityMonitorInstallation.decodeValidated(
            try XCTUnwrap(store.read(forKey: deviceActivityMonitorInstallationStorageKey))))
        log.records = [PersistedCallbackObservation(kind: .intervalDidStart,
            activityId: installation.monitorActivityId, installationGeneration: installation.generation,
            observedAtUtc: installedAt.addingTimeInterval(1), sequence: 1)]

        let retryingShields = ShieldRecorder()
        retryingShields.applyFailuresRemaining = 2
        let restarted = PCAProductionProtectionPolicyRuntime(authorizationIsApproved: { true },
            scheduler: scheduler, blobStore: store, callbackLog: log,
            installationClock: { self.installedAt }, shieldEnforcer: retryingShields,
            pendingUsageActivator: { _ in })
        XCTAssertEqual(retryingShields.applyCount, 1, "startup restoration attempt fails once")
        XCTAssertEqual(restarted.callbackHealth(now: installedAt.addingTimeInterval(180)), .enforcementUnavailable,
            "callback evidence must not hide an unresolved ManagedSettings restore failure")
        XCTAssertEqual(retryingShields.applyCount, 2, "health evaluation retries the same committed generation")

        XCTAssertEqual(restarted.callbackHealth(now: installedAt.addingTimeInterval(180)), .healthy,
            "only successful replay of the exact active generation clears the degraded signal")
        XCTAssertEqual(retryingShields.applyCount, 3)
        XCTAssertEqual(restarted.callbackHealth(now: installedAt.addingTimeInterval(180)), .healthy)
        XCTAssertEqual(retryingShields.applyCount, 3, "successful reconciliation clears the retry marker")
        XCTAssertEqual(DeviceActivityMonitorInstallation.decodeValidated(
            try XCTUnwrap(store.read(forKey: deviceActivityMonitorInstallationStorageKey))), installation)
    }

    func testStartupMonitorRestoreFailureStaysDegradedDespiteRecentCallbackUntilRetrySucceeds() throws {
        let store = CallbackRuntimeBlobStore()
        let initialScheduler = CallbackRuntimeScheduler()
        let log = CallbackRuntimeLog()
        let initialShields = ShieldRecorder()
        let tokens = try PropertyListEncoder().encode(Set<ApplicationToken>())
        let initial = PCAProductionProtectionPolicyRuntime(authorizationIsApproved: { true },
            scheduler: initialScheduler, blobStore: store, callbackLog: log,
            installationClock: { self.installedAt }, shieldEnforcer: initialShields,
            pendingUsageActivator: { _ in })
        _ = try initial.applyVerifiedPolicy(
            scheduleData: policy("monitor-recovery", capability: .unavailable, restrictive: true),
            applicationTokenData: tokens, protectedApplicationTokenData: nil, now: installedAt)
        let installation = try XCTUnwrap(DeviceActivityMonitorInstallation.decodeValidated(
            try XCTUnwrap(store.read(forKey: deviceActivityMonitorInstallationStorageKey))))
        log.records = [PersistedCallbackObservation(kind: .intervalDidStart,
            activityId: installation.monitorActivityId, installationGeneration: installation.generation,
            observedAtUtc: installedAt.addingTimeInterval(1), sequence: 1)]

        let recoveryScheduler = CallbackRuntimeScheduler()
        let recoveryShields = ShieldRecorder()
        recoveryScheduler.failStart = true
        let restarted = PCAProductionProtectionPolicyRuntime(authorizationIsApproved: { true },
            scheduler: recoveryScheduler, blobStore: store, callbackLog: log,
            installationClock: { self.installedAt }, shieldEnforcer: recoveryShields,
            pendingUsageActivator: { _ in })
        XCTAssertEqual(recoveryScheduler.started, [installation.monitorActivityId])
        XCTAssertEqual(recoveryScheduler.stopped, [installation.monitorActivityId],
            "a failed OS registration is rolled back while the active manifest remains committed")
        XCTAssertEqual(restarted.callbackHealth(now: installedAt.addingTimeInterval(180)), .enforcementUnavailable,
            "a recent old callback receipt must not hide failed monitor restoration")
        XCTAssertEqual(recoveryScheduler.started.count, 2, "health evaluation retries missing registration")

        recoveryScheduler.failStart = false
        XCTAssertEqual(restarted.callbackHealth(now: installedAt.addingTimeInterval(180)), .healthy,
            "health returns to callback evidence only after monitor recovery succeeds")
        let successfulRecoveryIds = Array(recoveryScheduler.started.dropFirst(2))
        XCTAssertEqual(Set(successfulRecoveryIds), Set(installation.allMonitorActivityIds),
            "successful retry restores the complete committed monitor generation")
        XCTAssertEqual(successfulRecoveryIds.count, installation.allMonitorActivityIds.count)
        XCTAssertEqual(recoveryScheduler.started.count, 2 + installation.allMonitorActivityIds.count,
            "two failed primary-monitor attempts precede one complete generation restore")
        XCTAssertTrue(installation.allMonitorActivityIds.allSatisfy(recoveryScheduler.ownedMonitorActivityIds().contains))
        XCTAssertEqual(DeviceActivityMonitorInstallation.decodeValidated(
            try XCTUnwrap(store.read(forKey: deviceActivityMonitorInstallationStorageKey))), installation)
    }

    func testPostCommitSettingsFailureOnLiveRuntimeIsReportedUntilRetrySucceeds() throws {
        let store = CallbackRuntimeBlobStore()
        let scheduler = CallbackRuntimeScheduler()
        let log = CallbackRuntimeLog()
        let shields = ShieldRecorder()
        shields.applyFailuresRemaining = 2
        let tokens = try PropertyListEncoder().encode(Set<ApplicationToken>())
        let runtime = PCAProductionProtectionPolicyRuntime(authorizationIsApproved: { true },
            scheduler: scheduler, blobStore: store, callbackLog: log,
            installationClock: { self.installedAt }, shieldEnforcer: shields,
            pendingUsageActivator: { _ in })

        XCTAssertThrowsError(try runtime.applyVerifiedPolicy(
            scheduleData: policy("live", capability: .unavailable, restrictive: true),
            applicationTokenData: tokens, protectedApplicationTokenData: nil, now: installedAt))
        let installation = try XCTUnwrap(DeviceActivityMonitorInstallation.decodeValidated(
            try XCTUnwrap(store.read(forKey: deviceActivityMonitorInstallationStorageKey))))
        XCTAssertEqual(installation.state, .active,
            "settings failure occurs after the new generation has committed")
        log.records = [PersistedCallbackObservation(kind: .intervalDidStart,
            activityId: installation.monitorActivityId, installationGeneration: installation.generation,
            observedAtUtc: installedAt.addingTimeInterval(1), sequence: 1)]

        XCTAssertEqual(runtime.callbackHealth(now: installedAt.addingTimeInterval(180)), .enforcementUnavailable,
            "post-commit settings failure must not be hidden by healthy callback evidence")
        XCTAssertEqual(runtime.callbackHealth(now: installedAt.addingTimeInterval(180)), .healthy,
            "the committed generation becomes healthy only after its settings retry succeeds")
        XCTAssertEqual(shields.applyCount, 3)
        XCTAssertEqual(runtime.callbackHealth(now: installedAt.addingTimeInterval(180)), .healthy)
        XCTAssertEqual(shields.applyCount, 3, "success clears the marker for this exact generation")
    }

    func testUsageUnavailableDegradedResultDoesNotRetrySuccessfulSettings() throws {
        let store = CallbackRuntimeBlobStore()
        let scheduler = CallbackRuntimeScheduler()
        let log = CallbackRuntimeLog()
        let shields = ShieldRecorder()
        let runtime = PCAProductionProtectionPolicyRuntime(authorizationIsApproved: { true },
            scheduler: scheduler, blobStore: store, callbackLog: log,
            installationClock: { self.installedAt }, shieldEnforcer: shields,
            pendingUsageActivator: { _ in })
        XCTAssertEqual(try runtime.applyVerifiedPolicy(scheduleData: boundaryPolicy(daily: true),
            applicationTokenData: PropertyListEncoder().encode(Set<ApplicationToken>()),
            protectedApplicationTokenData: nil, now: installedAt), .degraded,
            "daily usage remains degraded when no trusted binding provider is available")
        let installation = try XCTUnwrap(DeviceActivityMonitorInstallation.decodeValidated(
            try XCTUnwrap(store.read(forKey: deviceActivityMonitorInstallationStorageKey))))
        log.records = [PersistedCallbackObservation(kind: .intervalDidStart,
            activityId: installation.monitorActivityId, installationGeneration: installation.generation,
            observedAtUtc: installedAt.addingTimeInterval(1), sequence: 1)]
        let successfulSettingsMutations = shields.applyCount + shields.removeCount

        XCTAssertEqual(runtime.callbackHealth(now: installedAt.addingTimeInterval(180)), .healthy)
        XCTAssertEqual(shields.applyCount + shields.removeCount, successfulSettingsMutations,
            "missing usage coverage must not be mistaken for a failed ManagedSettings reconciliation")
    }

    private let installedAt = ISO8601DateFormatter().date(from: "2025-06-03T12:00:00Z")!
    private let monitor = "pca-monitor-11111111-1111-4111-8111-111111111111"
    private let generation = "22222222-2222-4222-8222-222222222222"

    private func policy(_ id: String = "policy", capability: StoredEnforcementCapability = .enforced,
                        restrictive: Bool = false) throws -> Data {
        let windows = restrictive ? [StoredScheduleWindow(id: "all-day", kind: .bedtime,
            daysOfWeek: [0, 1, 2, 3, 4, 5, 6], start: .init(hour: 0, minute: 0),
            end: .init(hour: 23, minute: 59), appScope: .all, timezone: "UTC")] : []
        let value = StoredDeviceActivityPolicy(schemaVersion: 1, activityId: id, appToken: "opaque",
            timeZoneIdentifier: "UTC", windows: windows, bonusGrants: [], exceptions: [],
            dailyLimit: nil, enforcementCapability: capability)
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        return try encoder.encode(value)
    }

    private func installation(_ state: DeviceActivityMonitorInstallationState = .active) -> DeviceActivityMonitorInstallation {
        DeviceActivityMonitorInstallation(policyActivityId: "policy", monitorActivityId: monitor, generation: generation, installedAtUtc: installedAt, timeZoneIdentifier: "UTC", state: state)
    }

    private func seed(_ store: CallbackRuntimeBlobStore, state: DeviceActivityMonitorInstallationState = .active) throws {
        let emptyTokens = try PropertyListEncoder().encode(Set<ApplicationToken>())
        try store.write(policy(), forKey: "schedule.policy")
        try store.write(emptyTokens, forKey: "applicationTokens.policy")
        try store.write(emptyTokens, forKey: "protectedApplicationTokens")
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
        let shields = ShieldRecorder()
        scheduler.onStart = { id, _ in
            let pending = DeviceActivityMonitorInstallation.decodeValidated(store.read(forKey: deviceActivityMonitorInstallationStorageKey)!)
            XCTAssertEqual(pending?.state, .active)
            XCTAssertEqual(pending?.monitorActivityId, self.monitor)
            XCTAssertNotEqual(id, self.monitor)
            XCTAssertEqual(pending?.installedAtUtc, self.installedAt)
        }
        let runtime = PCAProductionProtectionPolicyRuntime(authorizationIsApproved: { true }, scheduler: scheduler,
            blobStore: store, callbackLog: InMemoryCallbackObservationLog(),
            installationClock: { self.installedAt }, shieldEnforcer: shields)
        XCTAssertEqual(DeviceActivityMonitorInstallation.decodeValidated(priorInstallation), installation())
        XCTAssertTrue(scheduler.ownedMonitorActivityIds().contains(monitor),
            "the seeded committed monitor is present before the staged replacement begins")
        XCTAssertEqual(runtime.callbackHealth(now: installedAt.addingTimeInterval(180)), .unknown,
            "the seeded generation is recoverable and has no callback evidence before replacement")
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
        let scheduler = CallbackRuntimeScheduler()
        let shields = ShieldRecorder()
        log.records = [PersistedCallbackObservation(kind: .intervalDidStart, activityId: monitor, installationGeneration: generation, observedAtUtc: installedAt.addingTimeInterval(1), sequence: 1)]
        let runtime = PCAProductionProtectionPolicyRuntime(authorizationIsApproved: { true }, scheduler: scheduler,
            blobStore: store, callbackLog: log, installationClock: { self.installedAt },
            shieldEnforcer: shields)
        let now = installedAt.addingTimeInterval(180)
        XCTAssertEqual(runtime.callbackHealth(now: now), .healthy)
        let restored = PCAProductionProtectionPolicyRuntime(authorizationIsApproved: { true }, scheduler: scheduler,
            blobStore: store, callbackLog: log, installationClock: { self.installedAt },
            shieldEnforcer: shields)
        XCTAssertEqual(restored.callbackHealth(now: now), .healthy)
        log.records = [PersistedCallbackObservation(kind: .intervalDidStart, activityId: "pca-monitor-33333333-3333-4333-8333-333333333333", installationGeneration: generation, observedAtUtc: installedAt.addingTimeInterval(1), sequence: 2)]
        XCTAssertEqual(restored.callbackHealth(now: now), .unknown, "old monitor callback must not certify the current installation")
        try store.write(policy("different-policy"), forKey: "schedule.policy")
        XCTAssertEqual(restored.callbackHealth(now: now), .unknown)
    }

    func testRestartCompletesRetirementAfterReplacementManifestCommit() throws {
        let store = CallbackRuntimeBlobStore()
        let scheduler = CallbackRuntimeScheduler()
        let prior = installation()
        try store.write(policy(), forKey: "schedule.policy")
        try store.write(PropertyListEncoder().encode(Set<ApplicationToken>()), forKey: "applicationTokens.policy")
        try store.write(PropertyListEncoder().encode(Set<ApplicationToken>()), forKey: "protectedApplicationTokens")
        try store.write(Data("policy".utf8), forKey: "activeActivityId")

        let replacementGeneration = "33333333-3333-4333-8333-333333333333"
        let replacementMonitor = "pca-monitor-44444444-4444-4444-8444-444444444444"
        let replacementSchedule = try policy("replacement")
        let replacementTokens = try PropertyListEncoder().encode(Set<ApplicationToken>())
        let replacementFloor = try PropertyListEncoder().encode(Set<ApplicationToken>())
        let replacement = DeviceActivityMonitorInstallation(
            policyActivityId: "replacement", monitorActivityId: replacementMonitor,
            generation: replacementGeneration, installedAtUtc: installedAt,
            timeZoneIdentifier: "UTC", state: .active, schemaVersion: 2,
            boundaryMonitors: [])
        try store.write(replacementSchedule, forKey: "schedule.replacement.\(replacementGeneration)")
        try store.write(replacementTokens, forKey: "applicationTokens.replacement.\(replacementGeneration)")
        try store.write(replacementFloor, forKey: "protectedApplicationTokens.\(replacementGeneration)")
        try store.write(Data("replacement".utf8), forKey: "activeActivityId")
        try store.write(JSONEncoder().encode(replacement), forKey: deviceActivityMonitorInstallationStorageKey)
        try store.write(JSONEncoder().encode(DeviceActivityPolicyRetirementIntent(previousInstallation: prior)),
            forKey: deviceActivityPolicyRetirementIntentStorageKey)
        scheduler.orphanIds = [monitor, replacementMonitor]

        _ = PCAProductionProtectionPolicyRuntime(authorizationIsApproved: { true },
            scheduler: scheduler, blobStore: store, installationClock: { self.installedAt })

        XCTAssertNil(store.read(forKey: deviceActivityPolicyRetirementIntentStorageKey))
        XCTAssertNil(store.read(forKey: "schedule.policy"), "retired generation schedule must be reclaimed after restart")
        XCTAssertNil(store.read(forKey: "applicationTokens.policy"))
        XCTAssertNil(store.read(forKey: "protectedApplicationTokens"))
        XCTAssertTrue(scheduler.stopped.contains(monitor), "the previous generation monitor must be retired")
        XCTAssertEqual(store.read(forKey: "schedule.replacement.\(replacementGeneration)"), replacementSchedule)
        XCTAssertEqual(store.read(forKey: "applicationTokens.replacement.\(replacementGeneration)"), replacementTokens)
        XCTAssertEqual(store.read(forKey: "protectedApplicationTokens.\(replacementGeneration)"), replacementFloor)
        XCTAssertEqual(DeviceActivityMonitorInstallation.decodeValidated(
            store.read(forKey: deviceActivityMonitorInstallationStorageKey)!), replacement)
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

    func testApplyingPolicyPreservesCorruptPresentManifestAndDoesNotRegister() throws {
        let store = CallbackRuntimeBlobStore()
        let corruptManifest = Data("corrupt installation manifest".utf8)
        let legacyPointer = Data("policy".utf8)
        try store.write(corruptManifest, forKey: deviceActivityMonitorInstallationStorageKey)
        try store.write(legacyPointer, forKey: "activeActivityId")
        let scheduler = CallbackRuntimeScheduler()
        let runtime = PCAProductionProtectionPolicyRuntime(authorizationIsApproved: { true },
            scheduler: scheduler, blobStore: store, installationClock: { self.installedAt })
        scheduler.orphanIds = [monitor]

        XCTAssertThrowsError(try runtime.applyVerifiedPolicy(scheduleData: policy(),
            applicationTokenData: PropertyListEncoder().encode(Set<ApplicationToken>()),
            protectedApplicationTokenData: nil, now: installedAt)) {
            XCTAssertEqual($0 as? PCAProtectionPolicyApplicationError, .persistenceFailed)
        }
        XCTAssertEqual(store.read(forKey: deviceActivityMonitorInstallationStorageKey), corruptManifest,
            "a failed decode must not be overwritten by a new generation")
        XCTAssertEqual(store.read(forKey: "activeActivityId"), legacyPointer,
            "a present corrupt manifest must not fall back to the legacy authority pointer")
        XCTAssertTrue(scheduler.started.isEmpty)
        XCTAssertTrue(scheduler.stopped.isEmpty,
            "without a valid manifest, applying another policy must not disturb the unknown existing installation")
    }

    func testOversizedTokenPayloadsAreRejectedBeforeReplacingCommittedPolicy() throws {
        let store = CallbackRuntimeBlobStore()
        let scheduler = CallbackRuntimeScheduler()
        let shields = ShieldRecorder()
        let runtime = PCAProductionProtectionPolicyRuntime(authorizationIsApproved: { true },
            scheduler: scheduler, blobStore: store, installationClock: { self.installedAt },
            shieldEnforcer: shields)
        let tokens = try PropertyListEncoder().encode(Set<ApplicationToken>())
        _ = try runtime.applyVerifiedPolicy(scheduleData: policy("existing", capability: .unavailable),
            applicationTokenData: tokens, protectedApplicationTokenData: nil, now: installedAt)
        let committedManifest = try XCTUnwrap(store.read(forKey: deviceActivityMonitorInstallationStorageKey))
        let committed = try XCTUnwrap(DeviceActivityMonitorInstallation.decodeValidated(committedManifest))
        let suffix = committed.payloadStorageGeneration.map { "." + $0 } ?? ""
        let committedSchedule = try XCTUnwrap(store.read(forKey: "schedule.existing\(suffix)"))
        let startsBefore = scheduler.started
        let stopsBefore = scheduler.stopped
        let appliesBefore = shields.applyCount
        let oversized = Data(repeating: 0, count: 1_048_577)

        for (applicationPayload, protectedPayload) in [(oversized, nil), (tokens, oversized)] {
            XCTAssertThrowsError(try runtime.applyVerifiedPolicy(
                scheduleData: policy("replacement", capability: .unavailable),
                applicationTokenData: applicationPayload,
                protectedApplicationTokenData: protectedPayload,
                now: installedAt)) {
                XCTAssertEqual($0 as? PCAProtectionPolicyApplicationError, .malformedPolicy)
            }
        }

        XCTAssertEqual(store.read(forKey: deviceActivityMonitorInstallationStorageKey), committedManifest)
        XCTAssertEqual(store.read(forKey: "schedule.existing\(suffix)"), committedSchedule)
        XCTAssertEqual(store.read(forKey: "activeActivityId"), Data("existing".utf8))
        XCTAssertEqual(scheduler.started, startsBefore, "oversized token sets must fail before monitor registration")
        XCTAssertEqual(scheduler.stopped, stopsBefore, "oversized token sets must preserve current monitors")
        XCTAssertEqual(shields.applyCount, appliesBefore, "oversized token sets must not change enforcement")
    }

    private func boundaryPolicy(windowCount: Int = 1, daily: Bool = false) throws -> Data {
        let windows = (0..<windowCount).map { StoredScheduleWindow(id: "w\($0)", kind: .bedtime, daysOfWeek: [0,1,2,3,4,5,6], start: .init(hour: $0, minute: 0), end: .init(hour: $0, minute: 1), appScope: .all, timezone: "UTC") }
        let limit = daily ? StoredDailyAppLimit(appScope: .all, limitMinutes: 60, usedMinutesToday: 0, anchorLocalDate: "2025-06-03") : nil
        let policy = StoredDeviceActivityPolicy(schemaVersion: 1, activityId: "policy", appToken: "opaque", timeZoneIdentifier: "Asia/Riyadh", windows: windows, bonusGrants: [], exceptions: [], dailyLimit: limit, enforcementCapability: .enforced)
        let encoder = JSONEncoder(); encoder.dateEncodingStrategy = .iso8601
        return try encoder.encode(policy)
    }
    func testBoundaryGroupBecomesActiveOnlyAfterEveryRegistration() throws {
        let store = CallbackRuntimeBlobStore(), scheduler = CallbackRuntimeScheduler()
        scheduler.onStart = { id, _ in
            let starting = DeviceActivityMonitorInstallation.decodeValidated(
                store.read(forKey: deviceActivityMonitorInstallationStorageKey)!)
            XCTAssertEqual(starting?.state, .starting,
                "the first-install staging manifest is durable before callback-capable monitors start")
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

    func testPolicyApplicationUsesCallerTimeForPlanningAndEnforcement() throws {
        let callerNow = ISO8601DateFormatter().date(from: "2025-06-03T09:00:00Z")!
        let installedAt = ISO8601DateFormatter().date(from: "2025-06-03T12:00:00Z")!
        let exceptionStart = ISO8601DateFormatter().date(from: "2025-06-03T10:30:00Z")!
        let exceptionEnd = ISO8601DateFormatter().date(from: "2025-06-03T11:00:00Z")!
        let activeWindow = StoredScheduleWindow(id: "evening", kind: .bedtime,
            daysOfWeek: [2], start: .init(hour: 8, minute: 0), end: .init(hour: 10, minute: 0),
            appScope: .all, timezone: "UTC")
        let policy = StoredDeviceActivityPolicy(schemaVersion: 1, activityId: "policy", appToken: "opaque",
            timeZoneIdentifier: "UTC", windows: [activeWindow], bonusGrants: [],
            exceptions: [StoredParentException(id: "expired-before-install", appScope: .all,
                startAtUtc: exceptionStart, endAtUtc: exceptionEnd)], dailyLimit: nil,
            enforcementCapability: .enforced)
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        let scheduleData = try encoder.encode(policy)
        let store = CallbackRuntimeBlobStore()
        let scheduler = CallbackRuntimeScheduler()
        let shields = ShieldRecorder()
        let runtime = PCAProductionProtectionPolicyRuntime(authorizationIsApproved: { true },
            scheduler: scheduler, blobStore: store, installationClock: { installedAt },
            shieldEnforcer: shields)

        XCTAssertEqual(try runtime.applyVerifiedPolicy(scheduleData: scheduleData,
            applicationTokenData: PropertyListEncoder().encode(Set<ApplicationToken>()),
            protectedApplicationTokenData: nil, now: callerNow), .applied)

        let installation = try XCTUnwrap(DeviceActivityMonitorInstallation.decodeValidated(
            try XCTUnwrap(store.read(forKey: deviceActivityMonitorInstallationStorageKey))))
        XCTAssertEqual(installation.installedAtUtc, installedAt,
            "installationClock records OS installation time independently of caller policy time")
        XCTAssertEqual(installation.boundaryMonitors?.count, 4,
            "the two exception boundaries are still future at callerNow even though they predate installationClock")
        XCTAssertEqual(shields.applyCount, 1,
            "the active Tuesday window is evaluated at callerNow, not the noon installation timestamp")
        XCTAssertEqual(shields.removeCount, 0)
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
        try store.write(Data("staged-usage".utf8), forKey: "usage.pending." + incomplete.generation)
        let restartScheduler = CallbackRuntimeScheduler()
        _ = PCAProductionProtectionPolicyRuntime(authorizationIsApproved: { true }, scheduler: restartScheduler, blobStore: store)
        XCTAssertEqual(Set(restartScheduler.stopped), Set(current.allMonitorActivityIds))
        XCTAssertNil(store.read(forKey: deviceActivityMonitorInstallationStorageKey))
        XCTAssertNil(store.read(forKey: "usage.pending." + incomplete.generation),
            "relaunch recovery must discard only staged usage from the incomplete generation")
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
        store.failKey = deviceActivityMonitorInstallationStorageKey
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
