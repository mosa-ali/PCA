import XCTest
import Foundation
@testable import PCA

final class DeviceActivityUsageAttributionTests: XCTestCase {
    private final class Store: OpaqueBlobStore {
        var values: [String: Data] = [:]
        var ignoreWrites = false
        func write(_ data: Data, forKey key: String) throws { if !ignoreWrites { values[key] = data } }
        func read(forKey key: String) -> Data? { values[key] }
        func remove(forKey key: String) { values.removeValue(forKey: key) }
    }
    private struct PersistedRecordFixture: Codable {
        let binding: DeviceActivityUsageSelectionBinding
        let localDate: String
        let zone: String
        let dayStart: Date
        let dayEnd: Date
        let minutes: Int
    }
    private struct PersistedStateFixture: Codable {
        let schemaVersion: Int
        let records: [PersistedRecordFixture]
    }
    private struct Token: Hashable, Codable { let value: String }
    private let now = Date(timeIntervalSince1970: 1_760_011_200)
    func testScopeDecodingPreservesDistinctOpaqueUnicodeIdentities() throws {
        let original = StoredAppScope.apps(["é", "e\u{301}"])
        let decoded = try JSONDecoder().decode(StoredAppScope.self, from: JSONEncoder().encode(original))
        guard case .apps(let identities) = decoded else { return XCTFail("Expected app scope") }
        XCTAssertEqual(identities.count, 2)
        let scope = AppScope.apps(identities)
        XCTAssertTrue(scope.includes("é"))
        XCTAssertTrue(scope.includes("e\u{301}"))
        XCTAssertNotEqual(AppScope.apps(["é"]), AppScope.apps(["e\u{301}"]))
        let candidate = DecodedSchedulePolicy(activityId: "policy", appToken: "é",
            timeZone: TimeZone(identifier: "UTC")!, windows: [], bonusGrants: [], exceptions: [],
            dailyLimit: DailyAppLimit(appScope: scope, limitMinutes: 60, usedMinutesToday: 0,
                anchorLocalDate: "2000-01-01"), enforcementCapability: .enforced)
        XCTAssertThrowsError(try DeviceActivityUsagePlanner.plan(policy: candidate, binding: binding("é"),
            generation: UUID().uuidString, now: now, deviceTimeZone: TimeZone(identifier: "UTC")!,
            historicalActivitySupported: true, otherMonitorCount: 1))
    }
    private func binding(_ name: String = "app") throws -> DeviceActivityUsageSelectionBinding {
        DeviceActivityUsageSelectionBinding(logicalAppToken: name,
            applicationTokenData: try PropertyListEncoder().encode(Token(value: "opaque")))
    }
    private func policy(zone: String = "UTC", minutes: Int = 60, bonuses: [BonusGrant] = [],
                        exceptions: [ParentException] = [], capability: EnforcementCapabilityState = .enforced) -> DecodedSchedulePolicy {
        DecodedSchedulePolicy(activityId: "policy", appToken: "app", timeZone: TimeZone(identifier: zone)!,
            windows: [], bonusGrants: bonuses, exceptions: exceptions,
            dailyLimit: DailyAppLimit(appScope: .all, limitMinutes: minutes, usedMinutesToday: 0,
                anchorLocalDate: "2000-01-01"), enforcementCapability: capability)
    }
    private func plan(_ policy: DecodedSchedulePolicy, deviceZone: String = "UTC", count: Int = 1) throws -> DeviceActivityUsageDayPlan {
        try DeviceActivityUsagePlanner.plan(policy: policy, binding: binding(), generation: UUID().uuidString,
            now: now, deviceTimeZone: TimeZone(identifier: deviceZone)!,
            historicalActivitySupported: true, otherMonitorCount: count)
    }
    func testBindingRequiresExplicitExactIdentityAndSingleton() throws {
        let pair = try binding("é")
        XCTAssertTrue(pair.matches(Set([Token(value: "opaque")]), logicalAppToken: "é"))
        XCTAssertFalse(pair.matches(Set([Token(value: "opaque")]), logicalAppToken: "e\u{301}"))
        XCTAssertFalse(pair.matches(Set<Token>(), logicalAppToken: "é"))
        XCTAssertFalse(pair.matches(Set([Token(value: "opaque"), Token(value: "other")]), logicalAppToken: "é"))
    }
    func testPlanMustMatchStoredPolicyThresholds() throws {
        let value = try plan(policy())
        XCTAssertTrue(value.isValid)
        XCTAssertTrue(value.matches(policy: policy()))
        XCTAssertFalse(value.matches(policy: policy(minutes: 61)))
        XCTAssertFalse(value.matches(policy: policy(zone: "Asia/Aden")))
    }
    func testTimezoneMismatchRejectsNewObservationWithoutInvalidatingPolicyDay() throws {
        let value = try plan(policy())
        XCTAssertTrue(value.contains(now, deviceTimeZone: TimeZone(identifier: "UTC")!))
        XCTAssertFalse(value.contains(now, deviceTimeZone: TimeZone(identifier: "Asia/Aden")!))
        XCTAssertTrue(now >= value.dayStartUtc && now < value.dayEndUtc)
    }
    func testFractionalTimezoneUsesOnlyInDayAccounting() throws {
        let value = try plan(policy(zone: "Asia/Kathmandu"))
        XCTAssertEqual(value.coverage, .partialPolicyDayPlanned)
        XCTAssertGreaterThan(value.accountingStartUtc, value.dayStartUtc)
        XCTAssertLessThan(value.accountingStartUtc, value.dayEndUtc)
    }
    func testMonitorBudgetAndNumericBoundsRejectBeforeRegistration() throws {
        XCTAssertNoThrow(try plan(policy(), count: 19))
        XCTAssertThrowsError(try plan(policy(), count: 20))
        XCTAssertThrowsError(try plan(policy(minutes: -1)))
        XCTAssertThrowsError(try plan(policy(minutes: Int.max)))
    }
    func testFinitePlanExpiresAtPolicyMidnightWithoutClaimingRenewal() throws {
        let value = try plan(policy())
        let utc = TimeZone(identifier: "UTC")!
        XCTAssertEqual(value.status(at: now, deviceTimeZone: utc), .planned(.wholePolicyDayPlanned))
        XCTAssertEqual(value.status(at: value.dayEndUtc, deviceTimeZone: utc), .expired)
        XCTAssertEqual(value.status(at: value.accountingStartUtc.addingTimeInterval(-1), deviceTimeZone: utc), .unavailable)
        XCTAssertEqual(value.status(at: now, deviceTimeZone: TimeZone(identifier: "Asia/Aden")!), .deviceTimeZoneChanged)
    }
    func testEvaluationUsesMaximumWithoutMutatingPolicyOrUpgradingCoverage() {
        let original = policy()
        let input = DeviceActivityUsageEvaluation.input(policy: original, now: now,
            lowerBoundMinutes: 60, coverageAvailable: false)
        XCTAssertEqual(input.dailyLimit?.usedMinutesToday, 60)
        XCTAssertEqual(original.dailyLimit?.usedMinutesToday, 0)
        XCTAssertEqual(input.enforcementCapability, .degraded)
    }
    private func install(_ plan: DeviceActivityUsageDayPlan, store: Store, active: Bool) throws {
        let manifest = DeviceActivityMonitorInstallation(policyActivityId: plan.policyActivityId,
            monitorActivityId: "pca-monitor-" + UUID().uuidString, generation: plan.generation,
            installedAtUtc: now, timeZoneIdentifier: "UTC", state: active ? .active : .starting,
            schemaVersion: 3, boundaryMonitors: [], usageDayPlan: plan)
        try store.write(JSONEncoder().encode(manifest), forKey: deviceActivityMonitorInstallationStorageKey)
        if active { try store.write(Data(plan.policyActivityId.utf8), forKey: "activeActivityId") }
        else { store.remove(forKey: "activeActivityId") }
    }
    func testStartingObservationPublishesOnlyAfterActiveCommitAndDuplicatesDoNotAdd() throws {
        let store = Store(), value = try plan(policy())
        let usage = DeviceActivityUsageLowerBoundStore<Token>(store: store)
        let event = try XCTUnwrap(value.thresholds.first)
        try install(value, store: store, active: false)
        try usage.stage(plan: value, activityId: value.monitorActivityId, eventId: event.eventId,
            at: now, deviceTimeZone: TimeZone(identifier: "UTC")!)
        XCTAssertNil(try usage.lowerBound(for: value))
        XCTAssertThrowsError(try usage.activate(plan: value))
        try install(value, store: store, active: true)
        try usage.activate(plan: value)
        XCTAssertEqual(try usage.lowerBound(for: value), 60)
        for _ in 0..<3 {
            XCTAssertEqual(try usage.record(plan: value, activityId: value.monitorActivityId,
                eventId: event.eventId, at: now, deviceTimeZone: TimeZone(identifier: "UTC")!), 60)
        }
        XCTAssertEqual(try usage.lowerBound(for: value), 60)
    }
    func testStaleManifestAndFailedReadbackCannotPublishObservation() throws {
        let store = Store(), value = try plan(policy())
        let usage = DeviceActivityUsageLowerBoundStore<Token>(store: store)
        let event = try XCTUnwrap(value.thresholds.first)
        XCTAssertThrowsError(try usage.record(plan: value, activityId: value.monitorActivityId,
            eventId: event.eventId, at: now, deviceTimeZone: TimeZone(identifier: "UTC")!))
        try install(value, store: store, active: true)
        store.ignoreWrites = true
        XCTAssertThrowsError(try usage.record(plan: value, activityId: value.monitorActivityId,
            eventId: event.eventId, at: now, deviceTimeZone: TimeZone(identifier: "UTC")!))
        XCTAssertNil(try usage.lowerBound(for: value))
    }
    func testCorruptRetainedStateIsAnErrorRatherThanZeroUsage() throws {
        let store = Store(), value = try plan(policy())
        store.values["com.pca.app.deviceactivity.usage-lower-bound.v1"] = Data("broken".utf8)
        XCTAssertThrowsError(try DeviceActivityUsageLowerBoundStore<Token>(store: store).lowerBound(for: value))
    }
    func testPersistedZeroMinuteRecordIsUnavailableState() throws {
        let store = Store(), value = try plan(policy())
        let impossible = PersistedRecordFixture(binding: value.binding, localDate: value.localDate,
            zone: value.policyTimeZoneIdentifier, dayStart: value.dayStartUtc, dayEnd: value.dayEndUtc, minutes: 0)
        store.values["com.pca.app.deviceactivity.usage-lower-bound.v1"] = try JSONEncoder().encode(
            PersistedStateFixture(schemaVersion: 1, records: [impossible]))

        XCTAssertThrowsError(try DeviceActivityUsageLowerBoundStore<Token>(store: store).lowerBound(for: value)) {
            XCTAssertEqual($0 as? DeviceActivityUsageError, .unavailableState)
        }
    }
    func testEquivalentDecodedTokenEncodingRetainsSameDayMaximumAcrossGeneration() throws {
        let store = Store(), first = try plan(policy())
        let usage = DeviceActivityUsageLowerBoundStore<Token>(store: store)
        try install(first, store: store, active: true)
        let event = try XCTUnwrap(first.thresholds.first)
        _ = try usage.record(plan: first, activityId: first.monitorActivityId, eventId: event.eventId,
            at: now, deviceTimeZone: TimeZone(identifier: "UTC")!)
        let encoder = PropertyListEncoder()
        encoder.outputFormat = .xml
        let equivalent = DeviceActivityUsageSelectionBinding(logicalAppToken: "app",
            applicationTokenData: try encoder.encode(Token(value: "opaque")))
        XCTAssertNotEqual(equivalent.applicationTokenData, first.binding.applicationTokenData)
        let replacement = try DeviceActivityUsagePlanner.plan(policy: policy(), binding: equivalent,
            generation: UUID().uuidString, now: now, deviceTimeZone: TimeZone(identifier: "UTC")!,
            historicalActivitySupported: true, otherMonitorCount: 1)
        try install(replacement, store: store, active: true)
        XCTAssertEqual(try usage.lowerBound(for: replacement), 60)
        XCTAssertThrowsError(try usage.record(plan: first, activityId: first.monitorActivityId,
            eventId: event.eventId, at: now, deviceTimeZone: TimeZone(identifier: "UTC")!))
    }
    func testPolicyDaysFollowSpringAndFallDSTIntervals() throws {
        let formatter = ISO8601DateFormatter()
        let zone = TimeZone(identifier: "America/New_York")!
        for (stamp, hours) in [("2026-03-08T12:00:00Z", 23), ("2026-11-01T12:00:00Z", 25)] {
            let value = try DeviceActivityUsagePlanner.plan(policy: policy(zone: zone.identifier), binding: binding(),
                generation: UUID().uuidString, now: XCTUnwrap(formatter.date(from: stamp)),
                deviceTimeZone: zone, historicalActivitySupported: true, otherMonitorCount: 1)
            XCTAssertEqual(value.dayEndUtc.timeIntervalSince(value.dayStartUtc), Double(hours * 3600))
            XCTAssertEqual(value.coverage, .wholePolicyDayPlanned)
            XCTAssertTrue(value.matches(policy: policy(zone: zone.identifier)))
        }
    }
    func testProcessorStagesThenConsumesOnlyCurrentStoredPolicyGeneration() throws {
        let store = Store(), value = try plan(policy())
        let stored = StoredDeviceActivityPolicy(schemaVersion: 1, activityId: "policy", appToken: "app",
            timeZoneIdentifier: "UTC", windows: [], bonusGrants: [], exceptions: [],
            dailyLimit: StoredDailyAppLimit(appScope: .all, limitMinutes: 60, usedMinutesToday: 0,
                anchorLocalDate: "2000-01-01"), enforcementCapability: .enforced)
        let encoder = JSONEncoder(); encoder.dateEncodingStrategy = .iso8601
        try store.write(encoder.encode(stored), forKey: "schedule.policy." + value.generation)
        try store.write(PropertyListEncoder().encode(Set([Token(value: "opaque")])),
            forKey: "applicationTokens.policy." + value.generation)
        try store.write(PropertyListEncoder().encode(Set<Token>()), forKey: "protectedApplicationTokens." + value.generation)
        let processor = DeviceActivityUsageCallbackProcessor<Token>(store: store)
        let event = try XCTUnwrap(value.thresholds.first)
        let utc = TimeZone(identifier: "UTC")!
        try install(value, store: store, active: false)
        XCTAssertFalse(try processor.consume(activityId: value.monitorActivityId,
            eventId: event.eventId, at: now, deviceTimeZone: utc))
        XCTAssertNil(try DeviceActivityUsageLowerBoundStore<Token>(store: store).lowerBound(for: value))
        try install(value, store: store, active: true)
        XCTAssertTrue(try processor.consume(activityId: value.monitorActivityId,
            eventId: event.eventId, at: now, deviceTimeZone: utc))
        XCTAssertEqual(try DeviceActivityUsageLowerBoundStore<Token>(store: store).lowerBound(for: value), 60)
        // A valid-looking manifest threshold must still agree with the stored policy.
        let manifestKey = deviceActivityMonitorInstallationStorageKey
        let originalManifest = try XCTUnwrap(store.read(forKey: manifestKey))
        var object = try XCTUnwrap(JSONSerialization.jsonObject(with: originalManifest) as? [String: Any])
        var alteredPlan = try XCTUnwrap(object["usageDayPlan"] as? [String: Any])
        var thresholds = try XCTUnwrap(alteredPlan["thresholds"] as? [[String: Any]])
        thresholds[0]["minutes"] = 61
        alteredPlan["thresholds"] = thresholds
        object["usageDayPlan"] = alteredPlan
        try store.write(JSONSerialization.data(withJSONObject: object), forKey: manifestKey)
        XCTAssertNotNil(DeviceActivityMonitorInstallation.decodeValidated(try XCTUnwrap(store.read(forKey: manifestKey))))
        XCTAssertThrowsError(try processor.consume(activityId: value.monitorActivityId,
            eventId: event.eventId, at: now, deviceTimeZone: utc))
        try store.write(originalManifest, forKey: manifestKey)
        let tokenKey = "applicationTokens.policy." + value.generation
        let originalTokens = try XCTUnwrap(store.read(forKey: tokenKey))
        try store.write(Data("malformed token".utf8), forKey: tokenKey)
        XCTAssertThrowsError(try processor.consume(activityId: value.monitorActivityId,
            eventId: event.eventId, at: now, deviceTimeZone: utc))
        try store.write(originalTokens, forKey: tokenKey)
        store.remove(forKey: "activeActivityId")
        XCTAssertThrowsError(try processor.consume(activityId: value.monitorActivityId,
            eventId: event.eventId, at: now, deviceTimeZone: utc))
    }
    func testObservedQuotaIsExtendedOnlyDuringBonusAndRestoredAtExpiry() throws {
        let bonus = BonusGrant(id: "bonus", appScope: .all, extraMinutes: 15,
            grantedAt: now.addingTimeInterval(-60), expiresAt: now.addingTimeInterval(60))
        let value = policy(bonuses: [bonus])
        let plan = try self.plan(value)
        XCTAssertEqual(Set(plan.thresholds.map(\.minutes)), Set([60, 75]))
        let during = ScheduleEngine.evaluate(DeviceActivityUsageEvaluation.input(policy: value,
            now: now, lowerBoundMinutes: 60, coverageAvailable: true))
        XCTAssertEqual(during.kind, .allowedBonus)
        XCTAssertEqual(during.remainingMinutesToday, 15)
        let after = ScheduleEngine.evaluate(DeviceActivityUsageEvaluation.input(policy: value,
            now: bonus.expiresAt, lowerBoundMinutes: 60, coverageAvailable: true))
        XCTAssertEqual(after.kind, .blockedLimitReached)
        XCTAssertEqual(value.dailyLimit?.usedMinutesToday, 0)
    }
    func testUnavailableCapabilityCannotBeUpgradedByUsageEvidence() {
        let input = DeviceActivityUsageEvaluation.input(policy: policy(capability: .unavailable),
            now: now, lowerBoundMinutes: 60, coverageAvailable: true)
        XCTAssertEqual(input.enforcementCapability, .unavailable)
        XCTAssertEqual(ScheduleEngine.evaluate(input).kind, .enforcementUnavailable)
    }
    func testParentExceptionOverridesObservedQuotaOnlyUntilItsExpiry() {
        let exception = ParentException(id: "parent", appScope: .all,
            startAt: now.addingTimeInterval(-60), endAt: now.addingTimeInterval(60))
        let value = policy(exceptions: [exception])
        XCTAssertEqual(ScheduleEngine.evaluate(DeviceActivityUsageEvaluation.input(policy: value,
            now: now, lowerBoundMinutes: 60, coverageAvailable: true)).kind, .allowedException)
        XCTAssertEqual(ScheduleEngine.evaluate(DeviceActivityUsageEvaluation.input(policy: value,
            now: exception.endAt, lowerBoundMinutes: 60, coverageAvailable: true)).kind, .blockedLimitReached)
    }
    func testReorderedThresholdsNeverReduceRetainedMaximum() throws {
        let bonus = BonusGrant(id: "bonus", appScope: .all, extraMinutes: 15,
            grantedAt: now.addingTimeInterval(-60), expiresAt: now.addingTimeInterval(60))
        let value = try plan(policy(bonuses: [bonus]))
        let store = Store()
        // The observed store is shared with the active manifest, just as in production.
        let sharedUsage = DeviceActivityUsageLowerBoundStore<Token>(store: store)
        try install(value, store: store, active: true)
        let utc = TimeZone(identifier: "UTC")!
        for minutes in [75, 60, 75, 60] {
            let event = try XCTUnwrap(value.thresholds.first(where: { $0.minutes == minutes }))
            XCTAssertEqual(try sharedUsage.record(plan: value, activityId: value.monitorActivityId,
                eventId: event.eventId, at: now, deviceTimeZone: utc), 75)
        }
        XCTAssertEqual(try sharedUsage.lowerBound(for: value), 75)
    }
    func testFailedHigherObservationPreservesPreviouslyPersistedLowerBound() throws {
        let bonus = BonusGrant(id: "bonus", appScope: .all, extraMinutes: 15,
            grantedAt: now.addingTimeInterval(-60), expiresAt: now.addingTimeInterval(60))
        let value = try plan(policy(bonuses: [bonus]))
        let store = Store(), utc = TimeZone(identifier: "UTC")!
        let usage = DeviceActivityUsageLowerBoundStore<Token>(store: store)
        try install(value, store: store, active: true)
        let low = try XCTUnwrap(value.thresholds.first(where: { $0.minutes == 60 }))
        let high = try XCTUnwrap(value.thresholds.first(where: { $0.minutes == 75 }))
        _ = try usage.record(plan: value, activityId: value.monitorActivityId, eventId: low.eventId,
            at: now, deviceTimeZone: utc)
        store.ignoreWrites = true
        XCTAssertThrowsError(try usage.record(plan: value, activityId: value.monitorActivityId,
            eventId: high.eventId, at: now, deviceTimeZone: utc))
        XCTAssertEqual(try usage.lowerBound(for: value), 60)
        store.ignoreWrites = false
        XCTAssertEqual(try usage.record(plan: value, activityId: value.monitorActivityId,
            eventId: high.eventId, at: now, deviceTimeZone: utc), 75)
    }
    func testSharedEnforcementBoundaryPreservesShieldsOnAttributionOrSafetyFailure() throws {
        var applied = 0, removed = 0
        let tokens = Set([Token(value: "opaque")])
        let store = Store(), value = try plan(policy())
        store.values["com.pca.app.deviceactivity.usage-lower-bound.v1"] = Data("corrupt".utf8)
        XCTAssertFalse(try DeviceActivityUsageEnforcement.reconcile(policy: policy(), now: now,
            applications: tokens, protectedApplications: [], coverageAvailable: true,
            loadLowerBound: { try DeviceActivityUsageLowerBoundStore<Token>(store: store).lowerBound(for: value) },
            apply: { _ in applied += 1 }, remove: { removed += 1 }))
        XCTAssertFalse(try DeviceActivityUsageEnforcement.reconcile(policy: policy(), now: now,
            applications: tokens, protectedApplications: tokens, coverageAvailable: true,
            loadLowerBound: { 60 }, apply: { _ in applied += 1 }, remove: { removed += 1 }))
        XCTAssertEqual(applied, 0)
        XCTAssertEqual(removed, 0)
        XCTAssertTrue(try DeviceActivityUsageEnforcement.reconcile(policy: policy(), now: now,
            applications: tokens, protectedApplications: [], coverageAvailable: true,
            loadLowerBound: { 60 }, apply: { _ in applied += 1 }, remove: { removed += 1 }))
        XCTAssertEqual(applied, 1)
        XCTAssertEqual(removed, 0)
    }
    func testSharedEnforcementPreservesShieldsWhenPendingActivationCannotPersist() throws {
        let store = Store(), value = try plan(policy())
        let usage = DeviceActivityUsageLowerBoundStore<Token>(store: store)
        let event = try XCTUnwrap(value.thresholds.first)
        try install(value, store: store, active: false)
        try usage.stage(plan: value, activityId: value.monitorActivityId, eventId: event.eventId,
            at: now, deviceTimeZone: TimeZone(identifier: "UTC")!)
        try install(value, store: store, active: true)
        store.ignoreWrites = true
        var mutations = 0
        let load: () throws -> Int? = {
            try usage.activate(plan: value)
            return try usage.lowerBound(for: value)
        }
        XCTAssertFalse(try DeviceActivityUsageEnforcement.reconcile(policy: policy(), now: now,
            applications: Set([Token(value: "opaque")]), protectedApplications: [],
            coverageAvailable: true, loadLowerBound: load,
            apply: { _ in mutations += 1 }, remove: { mutations += 1 }))
        XCTAssertEqual(mutations, 0)
        XCTAssertNotNil(store.read(forKey: "usage.pending." + value.generation))
        store.ignoreWrites = false
        XCTAssertTrue(try DeviceActivityUsageEnforcement.reconcile(policy: policy(), now: now,
            applications: Set([Token(value: "opaque")]), protectedApplications: [],
            coverageAvailable: true, loadLowerBound: load,
            apply: { _ in mutations += 1 }, remove: { XCTFail("Retained quota must restrict") }))
        XCTAssertEqual(mutations, 1)
    }
}
