import XCTest
@testable import PCA

final class PrayerNotificationSchedulingTests: XCTestCase {
    func testFutureFireDateIsScheduled() {
        let now = Date(timeIntervalSince1970: 1_700_000_000)
        let request = PrayerReminderRequest(id: "fajr", fireDate: now.addingTimeInterval(3600), title: "Fajr", body: "")
        XCTAssertEqual(PrayerNotificationScheduling.validate(request, nowUtc: now), .scheduled)
    }

    func testPastFireDateIsRejectedNeverSilentlyScheduled() {
        let now = Date(timeIntervalSince1970: 1_700_000_000)
        let request = PrayerReminderRequest(id: "fajr", fireDate: now.addingTimeInterval(-1), title: "Fajr", body: "")
        XCTAssertEqual(PrayerNotificationScheduling.validate(request, nowUtc: now), .rejectedPastFireDate)
    }
}

final class ChildStatusSnapshotTests: XCTestCase {
    private func snapshot(
        authorization: ChildAuthorizationState = .approved,
        sync: SyncConnectionState = .live,
        health: DeviceActivityCallbackHealth = .healthy
    ) -> ChildStatusSnapshot {
        ChildStatusSnapshot(authorization: authorization, syncConnection: sync, deviceActivityHealth: health, locationCapability: .active, capturedAtUtc: Date())
    }

    func testFullyHealthyOnlyWhenEverySignalIsHealthy() {
        XCTAssertTrue(snapshot().isFullyHealthy)
    }

    func testNotFullyHealthyWhenAuthorizationIsNotApproved() {
        XCTAssertFalse(snapshot(authorization: .revoked(to: .denied)).isFullyHealthy)
    }

    func testNotFullyHealthyWhenSyncIsStale() {
        XCTAssertFalse(snapshot(sync: .stale).isFullyHealthy)
    }

    func testNotFullyHealthyWhenDeviceActivityCallbacksAreDegraded() {
        let degraded = DeviceActivityCallbackHealth.degraded(missed: [ExpectedCallback(kind: .intervalDidStart, occurrenceAt: Date())])
        XCTAssertFalse(snapshot(health: degraded).isFullyHealthy)
    }
}

final class YouTubeVisibilityStatusTests: XCTestCase {
    func testModeALabelsAppUsageOnly() {
        XCTAssertEqual(YouTubeVisibilityStatus(mode: .modeA_AppDurationOnly).label, "App usage only")
    }

    func testModeBLabelIsExplicitlyMarkedControlled() {
        XCTAssertEqual(YouTubeVisibilityStatus(mode: .modeB_ControlledPlaybackObserved).label, "Mode B — PCA-controlled")
    }

    func testUnavailableIsNeverMislabeledAsEitherMode() {
        let status = YouTubeVisibilityStatus(mode: .unavailable)
        XCTAssertEqual(status.label, "Unavailable")
        XCTAssertNotEqual(status.label, "App usage only")
    }
}

final class OpaqueBlobStoreTests: XCTestCase {
    func testWriteThenReadRoundTrip() throws {
        let store = InMemoryBlobStore()
        try store.write(Data("selection-bytes".utf8), forKey: "child-1")
        XCTAssertEqual(store.read(forKey: "child-1"), Data("selection-bytes".utf8))
    }

    func testDistinctKeysNeverCollide() throws {
        let store = InMemoryBlobStore()
        try store.write(Data("a".utf8), forKey: "child-1")
        try store.write(Data("b".utf8), forKey: "child-2")
        XCTAssertEqual(store.read(forKey: "child-1"), Data("a".utf8))
        XCTAssertEqual(store.read(forKey: "child-2"), Data("b".utf8))
    }

    func testClearRemovesTheStoredBlob() throws {
        let blobStore = InMemoryBlobStore()
        try blobStore.write(Data("x".utf8), forKey: "child-1")
        let store = FamilyActivitySelectionStore(blobStore: blobStore)
        store.clear(forKey: "child-1")
        XCTAssertNil(blobStore.read(forKey: "child-1"))
    }
}

final class ChildEnrollmentCoordinatorTests: XCTestCase {
    // PCA-FR-008: age and initial policy change defaults without changing the
    // privacy boundary or permitting a child-side weakening.
    func testProfileConsumerAppliesStricterMinimumForYoungChild() {
        let profile = PCAEnrollmentProfile(
            childProfileId: "opaque-child",
            ageUxTier: .youngChild,
            initialPolicyProfile: .balanced
        )
        let coordinator = makeCoordinator()

        XCTAssertEqual(
            coordinator.consumeProfile(profile, authorization: .approved),
            .ready(
                PCAEnrollmentRuntimeDefaults(
                    contentFilterDefault: .strict,
                    activeUseThresholdMinutes: 45,
                    breakDurationMinutes: 30
                )
            )
        )
    }

    func testProfileConsumerProvidesCompleteTeenAndPolicyCatalogue() {
        let coordinator = makeCoordinator()
        let profiles: [(PCAAgeUxTier, PCAInitialPolicyProfile, PCAContentFilterDefault, Int)] = [
            (.youngChild, .balanced, .strict, 45),
            (.youngChild, .strict, .strict, 45),
            (.teen, .balanced, .moderate, 60),
            (.teen, .strict, .strict, 45),
        ]

        for (age, policy, filter, threshold) in profiles {
            let result = coordinator.consumeProfile(
                PCAEnrollmentProfile(childProfileId: nil, ageUxTier: age, initialPolicyProfile: policy),
                authorization: .approved
            )
            XCTAssertEqual(
                result,
                .ready(
                    PCAEnrollmentRuntimeDefaults(
                        contentFilterDefault: filter,
                        activeUseThresholdMinutes: threshold,
                        breakDurationMinutes: 30
                    )
                )
            )
        }
    }

    func testProfileConsumerBlocksEveryNonApprovedAuthorizationState() {
        let coordinator = makeCoordinator()
        let profile = PCAEnrollmentProfile(
            childProfileId: "opaque-child",
            ageUxTier: .teen,
            initialPolicyProfile: .balanced
        )
        let states: [ChildAuthorizationState] = [
            .notDetermined,
            .denied,
            .revoked(to: .denied),
            .revoked(to: .notDetermined),
            .entitlementUnavailable,
        ]

        for authorization in states {
            XCTAssertEqual(
                coordinator.consumeProfile(profile, authorization: authorization),
                .authorizationRequired(
                    PCAEnrollmentRuntimeDefaults(
                        contentFilterDefault: .moderate,
                        activeUseThresholdMinutes: 60,
                        breakDurationMinutes: 30
                    )
                )
            )
        }
    }

    func testProfileConsumerDoesNotCarryOpaqueChildIdIntoRuntimeDefaults() throws {
        let profile = PCAEnrollmentProfile(
            childProfileId: "opaque-child",
            ageUxTier: .teen,
            initialPolicyProfile: .balanced
        )
        let defaults = PCAEnrollmentProfileConsumer().defaults(for: profile)
        let encoded = try JSONEncoder().encode(defaults)
        let serialized = String(decoding: encoded, as: UTF8.self)

        XCTAssertFalse(serialized.contains("opaque-child"))
        XCTAssertFalse(serialized.contains("childProfileId"))
    }

    func testKeyMaterialPersistsBothDSKAndDEKIndependently() {
        let keychain = InMemoryKeychainStore()
        let keyMaterialStore = FamilyKeyMaterialStore(keychain: keychain, serviceNamespace: "com.pca.app")
        let authSource = FakeAuthorizationStatusSource()
        let coordinator = ChildEnrollmentCoordinator(keyMaterialStore: keyMaterialStore, authorizationCenter: ChildAuthorizationCenter(source: authSource))

        let result = coordinator.persistKeyMaterial(dsk: Data("dsk".utf8), dek: Data("dek".utf8), deviceId: "device-1")
        XCTAssertEqual(result, .keyMaterialReady)
        XCTAssertEqual(try? keyMaterialStore.retrieve(kind: .deviceSigningKey, deviceId: "device-1"), Data("dsk".utf8))
        XCTAssertEqual(try? keyMaterialStore.retrieve(kind: .deviceEncryptionKey, deviceId: "device-1"), Data("dek".utf8))
    }

    func testAuthorizationRequestFlowsThroughToTheEnrollmentResult() async {
        let keychain = InMemoryKeychainStore()
        let keyMaterialStore = FamilyKeyMaterialStore(keychain: keychain, serviceNamespace: "com.pca.app")
        let authSource = FakeAuthorizationStatusSource()
        let coordinator = ChildEnrollmentCoordinator(keyMaterialStore: keyMaterialStore, authorizationCenter: ChildAuthorizationCenter(source: authSource))

        let result = await coordinator.requestChildAuthorization()
        XCTAssertEqual(result, .authorizationState(.approved))
    }

    private func makeCoordinator() -> ChildEnrollmentCoordinator {
        ChildEnrollmentCoordinator(
            keyMaterialStore: FamilyKeyMaterialStore(
                keychain: InMemoryKeychainStore(),
                serviceNamespace: "com.pca.app"
            ),
            authorizationCenter: ChildAuthorizationCenter(source: FakeAuthorizationStatusSource())
        )
    }
}

final class PCAEnrollmentProfileRuntimeTests: XCTestCase {
    func testUniversalLinkAndCustomSchemeAcceptOnlyCanonicalOpaqueTokens() {
        let parser = PCAEnrollmentLinkParser()
        let token = String(repeating: "A", count: 43)

        let universal = parser.parse(URL(string: "https://enroll.pca.app/\(token)")!)
        XCTAssertEqual(universal?.rawInvitationToken, token)
        XCTAssertEqual(universal?.serverBaseURL.absoluteString, "https://enroll.pca.app")

        let custom = parser.parse(URL(string: "pca://enroll?token=\(token)")!)
        XCTAssertEqual(custom?.rawInvitationToken, token)
        XCTAssertEqual(custom?.serverBaseURL.absoluteString, "pca://enroll")

        XCTAssertNil(parser.parse(URL(string: "https://evil.example/\(token)")!))
        XCTAssertNil(parser.parse(URL(string: "https://enroll.pca.app/\(token)&other=child")!))
        XCTAssertNil(parser.parse(URL(string: "pca://enroll?token=short")!))

        let router = PCAEnrollmentLinkRouter()
        XCTAssertTrue(router.receive(URL(string: "https://enroll.pca.app/\(token)")!))
        XCTAssertEqual(router.takePendingLink()?.rawInvitationToken, token)
        XCTAssertNil(router.takePendingLink())
    }

    func testProfileIsDisplayedUnchangedAndPersistedOnlyAfterExplicitChildConfirmation() throws {
        let store = InMemoryPCAEnrollmentProfileStore()
        let audit = InMemoryPCAEnrollmentAuditSink()
        let profile = PCAEnrollmentProfile(
            childProfileId: "opaque-child",
            ageUxTier: .youngChild,
            initialPolicyProfile: .strict
        )
        let controller = PCAEnrollmentProfileRuntimeController(
            deviceId: "opaque-device",
            store: store,
            authorization: .approved,
            auditSink: audit,
            now: { Date(timeIntervalSince1970: 1_700_000_000) }
        )

        controller.receiveParentAuthorizedProfile(profile)
        guard case let .awaitingChildConfirmation(received, disclosure) = controller.state else {
            return XCTFail("the parent profile must require child confirmation")
        }
        XCTAssertEqual(received, profile)
        XCTAssertTrue(disclosure.parentSelectedProfile)
        XCTAssertNil(try store.load(forDeviceId: "opaque-device"))

        guard case let .ready(confirmed, defaults) = controller.confirmChildProfile() else {
            return XCTFail("approved authorization should make the confirmed profile ready")
        }
        XCTAssertEqual(confirmed, profile)
        XCTAssertEqual(defaults.contentFilterDefault, .strict)
        XCTAssertEqual(try store.load(forDeviceId: "opaque-device"), profile)
        XCTAssertEqual(audit.events.map(\.transition), [.parentProfilePresented, .childProfileConfirmed, .authorizationApproved])
        XCTAssertTrue(audit.events.allSatisfy { $0.actor == "CHILD_DEVICE" && $0.occurredAtUtc.timeIntervalSince1970 == 1_700_000_000 })
    }

    func testAuthorizationRequiredStateNeverPermitsRuntimeBeforeAppleApproval() {
        let profile = PCAEnrollmentProfile(childProfileId: nil, ageUxTier: .teen, initialPolicyProfile: .balanced)
        let controller = PCAEnrollmentProfileRuntimeController(
            deviceId: "opaque-device",
            store: InMemoryPCAEnrollmentProfileStore(),
            authorization: .notDetermined
        )
        controller.receiveParentAuthorizedProfile(profile)

        guard case .authorizationRequired = controller.confirmChildProfile() else {
            return XCTFail("profile confirmation must not imply Family Controls authorization")
        }
        XCTAssertFalse(controller.state.isRuntimeReady)

        guard case .ready = controller.updateAuthorization(.approved) else {
            return XCTFail("approved Family Controls state should open the runtime gate")
        }
        XCTAssertTrue(controller.state.isRuntimeReady)
    }

    func testUserDefaultsStoreRoundTripsOnlyTheParentAuthorizedProfile() throws {
        let suiteName = "pca-w85-\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        defer { defaults.removePersistentDomain(forName: suiteName) }
        let store = UserDefaultsPCAEnrollmentProfileStore(defaults: defaults, namespace: "test.profile")
        let profile = PCAEnrollmentProfile(childProfileId: "opaque-child", ageUxTier: .teen, initialPolicyProfile: .balanced)

        try store.save(profile, forDeviceId: "opaque-device")

        XCTAssertEqual(try store.load(forDeviceId: "opaque-device"), profile)
        XCTAssertNil(defaults.string(forKey: "test.profile.opaque-device"))
        let restored = PCAEnrollmentProfileRuntimeController(
            deviceId: "opaque-device",
            store: store,
            authorization: .approved
        )
        guard case .ready = restored.restorePersistedProfile() else {
            return XCTFail("a persisted profile must restore only after the approved runtime gate")
        }
        try store.remove(forDeviceId: "opaque-device")
        XCTAssertNil(try store.load(forDeviceId: "opaque-device"))
    }

    func testAgeTierChangesDefaultsButNotPrivacyDisclosure() {
        let young = PCAEnrollmentDisclosure.forProfile(
            PCAEnrollmentProfile(childProfileId: nil, ageUxTier: .youngChild, initialPolicyProfile: .balanced)
        )
        let teen = PCAEnrollmentDisclosure.forProfile(
            PCAEnrollmentProfile(childProfileId: nil, ageUxTier: .teen, initialPolicyProfile: .balanced)
        )

        XCTAssertEqual(young.readingLevel, .simple)
        XCTAssertEqual(teen.readingLevel, .clear)
        XCTAssertNotEqual(young.title, teen.title)
        XCTAssertEqual(young.monitoredSummary, teen.monitoredSummary)
        XCTAssertEqual(young.notMonitoredSummary, teen.notMonitoredSummary)
        XCTAssertEqual(young.emergencySummary, teen.emergencySummary)
        XCTAssertFalse(young.notMonitoredSummary.localizedCaseInsensitiveContains("appearance"))
        XCTAssertFalse(young.notMonitoredSummary.localizedCaseInsensitiveContains("body image"))
    }
}

private extension PCAEnrollmentProfileRuntimeState {
    var isRuntimeReady: Bool {
        if case .ready = self { return true }
        return false
    }
}

final class PCARecoverySecretDisclosureGateTests: XCTestCase {
    func testSingleParentAndMissingSecretDisclosureMustBeAcknowledgedBeforeGeneration() {
        var gate = PCARecoverySecretDisclosureGate()
        XCTAssertFalse(gate.authorizeGeneration())
        XCTAssertTrue(PCARecoverySecretDisclosureGate.summary.contains("only parent"))
        XCTAssertTrue(PCARecoverySecretDisclosureGate.summary.contains("lose the Recovery Secret"))
        XCTAssertTrue(PCARecoverySecretDisclosureGate.summary.contains("start a new family enrollment"))
        XCTAssertTrue(PCARecoverySecretDisclosureGate.summary.contains("support cannot recover"))

        gate.acknowledge()
        XCTAssertTrue(gate.authorizeGeneration())
    }
}

final class DeviceActivityBoundaryPlannerTests: XCTestCase {
    private let now = ISO8601DateFormatter().date(from: "2025-03-08T12:00:00Z")!
    private func window(_ id: String, _ start: TimeOfDay, _ end: TimeOfDay, zone: String = "UTC", kind: ScheduleWindowKind = .bedtime) -> ScheduleWindow {
        ScheduleWindow(id: id, kind: kind, daysOfWeek: [7], start: start, end: end, appScope: .all, timeZone: TimeZone(identifier: zone)!)
    }
    private func policy(windows: [ScheduleWindow] = [], exceptions: [ParentException] = [], bonus: [BonusGrant] = [], daily: DailyAppLimit? = nil) -> DecodedSchedulePolicy {
        DecodedSchedulePolicy(activityId: "policy", appToken: "opaque", timeZone: TimeZone(identifier: "Asia/Riyadh")!, windows: windows, bonusGrants: bonus, exceptions: exceptions, dailyLimit: daily, enforcementCapability: .enforced)
    }
    func testEdgesDeduplicateAcrossKindsAndPreserveTimezone() throws {
        let a = window("short", .init(hour: 23, minute: 58), .init(hour: 0, minute: 3))
        let b = window("allow", a.start, a.end, kind: .allowPeriod)
        let c = window("other-zone", a.start, a.end, zone: "America/New_York", kind: .schoolMode)
        let result = try DeviceActivityScheduleMapper.boundaryTriggers(for: policy(windows: [a,b,c]), now: now)
        XCTAssertEqual(result.count, 4)
        XCTAssertTrue(result.contains(.recurring(timeZoneIdentifier: TimeZone(identifier: "UTC")!.identifier, hour: 0, minute: 3)))
        XCTAssertTrue(result.contains(.recurring(timeZoneIdentifier: "America/New_York", hour: 23, minute: 58)))
        XCTAssertEqual(result, try DeviceActivityScheduleMapper.boundaryTriggers(for: policy(windows: [c,b,a]), now: now))
    }
    func testEqualEdgesRemainOneRecurringTriggerNotZeroLengthPolicy() throws {
        let result = try DeviceActivityScheduleMapper.boundaryTriggers(for: policy(windows: [window("full", .init(hour: 4, minute: 0), .init(hour: 4, minute: 0))]), now: now)
        XCTAssertEqual(result, [.recurring(timeZoneIdentifier: TimeZone(identifier: "UTC")!.identifier, hour: 4, minute: 0)])
    }
    func testMidnightUsesPolicyTimezoneOnlyWhenDailyLimitPresent() throws {
        let daily = DailyAppLimit(appScope: .all, limitMinutes: 60, usedMinutesToday: 20, anchorLocalDate: "2025-03-08")
        XCTAssertEqual(try DeviceActivityScheduleMapper.boundaryTriggers(for: policy(daily: daily), now: now), [.recurring(timeZoneIdentifier: "Asia/Riyadh", hour: 0, minute: 0)])
        XCTAssertTrue(try DeviceActivityScheduleMapper.boundaryTriggers(for: policy(), now: now).isEmpty)
    }
    func testAbsoluteEdgesStayUTCAndExpiredEdgesAreOmitted() throws {
        let start = now.addingTimeInterval(123.5), end = now.addingTimeInterval(456.5)
        let exception = ParentException(id: "exception", appScope: .all, startAt: start, endAt: end)
        let bonus = BonusGrant(id: "bonus", appScope: .all, extraMinutes: 10, grantedAt: now.addingTimeInterval(-10), expiresAt: end)
        let result = try DeviceActivityScheduleMapper.boundaryTriggers(for: policy(exceptions: [exception], bonus: [bonus]), now: now)
        XCTAssertEqual(Set(result), [.absolute(utc: start), .absolute(utc: end)])
    }
    func testCapacityRejectsWholePlanNeverTruncates() {
        let windows = (0..<10).map { window("w\($0)", .init(hour: $0, minute: 0), .init(hour: $0, minute: 1)) }
        XCTAssertThrowsError(try DeviceActivityScheduleMapper.boundaryTriggers(for: policy(windows: windows), now: now)) {
            XCTAssertEqual($0 as? DeviceActivityBoundaryPlanError, .excessiveMonitors)
        }
    }
    func testMalformedBoundaryRejected() {
        let bad = window("bad", .init(hour: 25, minute: 0), .init(hour: 2, minute: 0))
        XCTAssertThrowsError(try DeviceActivityScheduleMapper.boundaryTriggers(for: policy(windows: [bad]), now: now))
        XCTAssertThrowsError(try DeviceActivityScheduleMapper.boundaryTriggers(for: policy(), now: Date(timeIntervalSince1970: .infinity)))
    }
    func testDSTEdgesRetainWallClockZoneRatherThanFixedUTCOffset() throws {
        for date in ["2025-03-08T12:00:00Z", "2025-11-01T12:00:00Z"] {
            let at = ISO8601DateFormatter().date(from: date)!
            let result = try DeviceActivityScheduleMapper.boundaryTriggers(for: policy(windows: [window("dst", .init(hour: 1, minute: 30), .init(hour: 2, minute: 30), zone: "America/New_York")]), now: at)
            XCTAssertTrue(result.contains(.recurring(timeZoneIdentifier: "America/New_York", hour: 2, minute: 30)))
            XCTAssertEqual(result.count, 2)
        }
        // This proves representation only. Apple's gap/fold delivery is not
        // simulated here and remains a real-OS validation requirement.
    }
}
