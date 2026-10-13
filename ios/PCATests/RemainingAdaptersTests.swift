import XCTest
@testable import PCA
#if canImport(DeviceActivity)
import DeviceActivity
#endif

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

    func testNonFiniteFireOrCurrentDateIsRejected() {
        let now = Date(timeIntervalSince1970: 1_700_000_000)
        for invalidTime in [Double.nan, .infinity, -.infinity] {
            let invalidFireDate = PrayerReminderRequest(
                id: "fajr", fireDate: Date(timeIntervalSince1970: invalidTime), title: "Fajr", body: "")
            XCTAssertEqual(PrayerNotificationScheduling.validate(invalidFireDate, nowUtc: now), .rejectedInvalidDate)
            let invalidNow = Date(timeIntervalSince1970: invalidTime)
            let futureRequest = PrayerReminderRequest(
                id: "fajr", fireDate: now.addingTimeInterval(3600), title: "Fajr", body: "")
            XCTAssertEqual(PrayerNotificationScheduling.validate(futureRequest, nowUtc: invalidNow), .rejectedInvalidDate)
        }
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
        let coordinator = ChildEnrollmentCoordinator(keyMaterialStore: keyMaterialStore, authorizationCenter: ChildAuthorizationCenter(
            source: authSource, observationStore: InMemoryChildAuthorizationObservationStore()))

        let result = coordinator.persistKeyMaterial(dsk: Data("dsk".utf8), dek: Data("dek".utf8), deviceId: "device-1")
        XCTAssertEqual(result, .keyMaterialReady)
        XCTAssertEqual(try? keyMaterialStore.retrieve(kind: .deviceSigningKey, deviceId: "device-1"), Data("dsk".utf8))
        XCTAssertEqual(try? keyMaterialStore.retrieve(kind: .deviceEncryptionKey, deviceId: "device-1"), Data("dek".utf8))
    }

    func testKeyMaterialRejectsEmptyDeviceAndKeyInputsBeforeWritingEitherKey() {
        func makeCoordinator(_ keychain: InMemoryKeychainStore) -> (ChildEnrollmentCoordinator, FamilyKeyMaterialStore) {
            let store = FamilyKeyMaterialStore(keychain: keychain, serviceNamespace: "com.pca.app")
            let coordinator = ChildEnrollmentCoordinator(keyMaterialStore: store,
                authorizationCenter: ChildAuthorizationCenter(source: FakeAuthorizationStatusSource(),
                    observationStore: InMemoryChildAuthorizationObservationStore()))
            return (coordinator, store)
        }

        let emptyDeviceKeychain = InMemoryKeychainStore()
        let (emptyDeviceCoordinator, emptyDeviceStore) = makeCoordinator(emptyDeviceKeychain)
        guard case .keyMaterialFailed = emptyDeviceCoordinator.persistKeyMaterial(
            dsk: Data("dsk".utf8), dek: Data("dek".utf8), deviceId: " \n") else {
            return XCTFail("a blank device identifier must not be reported as enrolled key custody")
        }
        XCTAssertThrowsError(try emptyDeviceStore.retrieve(kind: .deviceSigningKey, deviceId: " \n"))
        XCTAssertThrowsError(try emptyDeviceStore.retrieve(kind: .deviceEncryptionKey, deviceId: " \n"))

        for (dsk, dek) in [(Data(), Data("dek".utf8)), (Data("dsk".utf8), Data())] {
            let keychain = InMemoryKeychainStore()
            let (coordinator, store) = makeCoordinator(keychain)
            guard case .keyMaterialFailed = coordinator.persistKeyMaterial(dsk: dsk, dek: dek, deviceId: "device-a") else {
                XCTFail("empty signing or encryption key bytes must fail before either Keychain item is written")
                continue
            }
            XCTAssertThrowsError(try store.retrieve(kind: .deviceSigningKey, deviceId: "device-a"))
            XCTAssertThrowsError(try store.retrieve(kind: .deviceEncryptionKey, deviceId: "device-a"))
        }
    }

    func testKeyMaterialRejectsReusingIdenticalBytesAcrossSigningAndEncryptionRoles() throws {
        let keychain = InMemoryKeychainStore()
        let store = FamilyKeyMaterialStore(keychain: keychain, serviceNamespace: "com.pca.app")
        let coordinator = ChildEnrollmentCoordinator(keyMaterialStore: store,
            authorizationCenter: ChildAuthorizationCenter(source: FakeAuthorizationStatusSource(),
                observationStore: InMemoryChildAuthorizationObservationStore()))
        let reusedMaterial = Data("same-private-key-material".utf8)

        guard case .keyMaterialFailed = coordinator.persistKeyMaterial(
            dsk: reusedMaterial, dek: reusedMaterial, deviceId: "device-role-reuse") else {
            return XCTFail("signing and encryption key roles must not persist the same private bytes")
        }
        XCTAssertThrowsError(try store.retrieve(kind: .deviceSigningKey, deviceId: "device-role-reuse"))
        XCTAssertThrowsError(try store.retrieve(kind: .deviceEncryptionKey, deviceId: "device-role-reuse"))
    }

    func testKeyMaterialRetryCompletesOnlyMatchingPartialPairAndRejectsReplacement() throws {
        let keychain = FailingEncryptionKeyWriteKeychain()
        let store = FamilyKeyMaterialStore(keychain: keychain, serviceNamespace: "com.pca.app")
        let coordinator = ChildEnrollmentCoordinator(keyMaterialStore: store,
            authorizationCenter: ChildAuthorizationCenter(source: FakeAuthorizationStatusSource(),
                observationStore: InMemoryChildAuthorizationObservationStore()))
        let dsk = Data("attempt-dsk".utf8)
        let dek = Data("attempt-dek".utf8)

        guard case .keyMaterialFailed = coordinator.persistKeyMaterial(dsk: dsk, dek: dek, deviceId: "device-retry") else {
            return XCTFail("a failed DEK write must not report a complete pair")
        }
        XCTAssertEqual(try store.retrieve(kind: .deviceSigningKey, deviceId: "device-retry"), dsk,
            "the durable first role is retained for same-attempt recovery")
        XCTAssertThrowsError(try store.retrieve(kind: .deviceEncryptionKey, deviceId: "device-retry"))

        XCTAssertEqual(coordinator.persistKeyMaterial(dsk: dsk, dek: dek, deviceId: "device-retry"), .keyMaterialReady,
            "a retry with the exact pair must write only the missing role")
        XCTAssertEqual(try store.retrieve(kind: .deviceSigningKey, deviceId: "device-retry"), dsk)
        XCTAssertEqual(try store.retrieve(kind: .deviceEncryptionKey, deviceId: "device-retry"), dek)
        XCTAssertEqual(keychain.successfulWrites, 2,
            "the retry must not replace the already persisted DSK")

        XCTAssertEqual(coordinator.persistKeyMaterial(dsk: dsk, dek: dek, deviceId: "device-retry"), .keyMaterialReady,
            "duplicate submission of the same pair is idempotent")
        guard case .keyMaterialFailed = coordinator.persistKeyMaterial(
            dsk: Data("replacement-dsk".utf8), dek: Data("replacement-dek".utf8), deviceId: "device-retry") else {
            return XCTFail("a different attempt must not silently replace existing device key custody")
        }
        XCTAssertEqual(keychain.successfulWrites, 2,
            "matching retries and conflicting submissions must not rewrite existing roles")
        XCTAssertEqual(try store.retrieve(kind: .deviceSigningKey, deviceId: "device-retry"), dsk)
        XCTAssertEqual(try store.retrieve(kind: .deviceEncryptionKey, deviceId: "device-retry"), dek)
    }

    func testKeyMaterialRequiresReadBackBeforeReportingReady() throws {
        let keychain = FailingEncryptionKeyWriteKeychain(failEncryptionWriteOnce: false, dropEncryptionWrite: true)
        let store = FamilyKeyMaterialStore(keychain: keychain, serviceNamespace: "com.pca.app")
        let coordinator = ChildEnrollmentCoordinator(keyMaterialStore: store,
            authorizationCenter: ChildAuthorizationCenter(source: FakeAuthorizationStatusSource(),
                observationStore: InMemoryChildAuthorizationObservationStore()))

        guard case .keyMaterialFailed = coordinator.persistKeyMaterial(
            dsk: Data("dsk".utf8), dek: Data("dek".utf8), deviceId: "device-readback") else {
            return XCTFail("a successful Keychain API return without a readable DEK must not report complete custody")
        }
        XCTAssertEqual(try store.retrieve(kind: .deviceSigningKey, deviceId: "device-readback"), Data("dsk".utf8))
        XCTAssertThrowsError(try store.retrieve(kind: .deviceEncryptionKey, deviceId: "device-readback"))

        XCTAssertEqual(coordinator.persistKeyMaterial(
            dsk: Data("dsk".utf8), dek: Data("dek".utf8), deviceId: "device-readback"), .keyMaterialReady,
            "a retry may finish the matching partial pair after the storage failure clears")
        XCTAssertEqual(try store.retrieve(kind: .deviceEncryptionKey, deviceId: "device-readback"), Data("dek".utf8))
    }

    func testAuthorizationRequestFlowsThroughToTheEnrollmentResult() async {
        let keychain = InMemoryKeychainStore()
        let keyMaterialStore = FamilyKeyMaterialStore(keychain: keychain, serviceNamespace: "com.pca.app")
        let authSource = FakeAuthorizationStatusSource()
        let coordinator = ChildEnrollmentCoordinator(keyMaterialStore: keyMaterialStore, authorizationCenter: ChildAuthorizationCenter(
            source: authSource, observationStore: InMemoryChildAuthorizationObservationStore()))

        let result = await coordinator.requestChildAuthorization()
        XCTAssertEqual(result, .authorizationState(.approved))
    }

    private func makeCoordinator() -> ChildEnrollmentCoordinator {
        ChildEnrollmentCoordinator(
            keyMaterialStore: FamilyKeyMaterialStore(
                keychain: InMemoryKeychainStore(),
                serviceNamespace: "com.pca.app"
            ),
            authorizationCenter: ChildAuthorizationCenter(source: FakeAuthorizationStatusSource(),
                observationStore: InMemoryChildAuthorizationObservationStore())
        )
    }
}

private final class FailingEncryptionKeyWriteKeychain: KeychainStoreProtocol {
    private let backing = InMemoryKeychainStore()
    private var shouldFailEncryptionWrite = true
    private var shouldDropEncryptionWrite: Bool
    private(set) var successfulWrites = 0

    init(failEncryptionWriteOnce: Bool = true, dropEncryptionWrite: Bool = false) {
        shouldFailEncryptionWrite = failEncryptionWriteOnce
        shouldDropEncryptionWrite = dropEncryptionWrite
    }

    func store(_ data: Data, forAccount account: String, service: String, accessibility: KeychainAccessibility) throws {
        if shouldFailEncryptionWrite && service.hasSuffix(".dek") {
            shouldFailEncryptionWrite = false
            throw KeychainStoreError.unexpectedStatus(-25300)
        }
        if shouldDropEncryptionWrite && service.hasSuffix(".dek") {
            shouldDropEncryptionWrite = false
            return
        }
        try backing.store(data, forAccount: account, service: service, accessibility: accessibility)
        successfulWrites += 1
    }

    func storeReplacingAtomically(_ data: Data, forAccount account: String, service: String, accessibility: KeychainAccessibility) throws {
        try store(data, forAccount: account, service: service, accessibility: accessibility)
    }

    func retrieve(forAccount account: String, service: String) throws -> Data {
        try backing.retrieve(forAccount: account, service: service)
    }

    func delete(forAccount account: String, service: String) throws {
        try backing.delete(forAccount: account, service: service)
    }
}

final class PCAEnrollmentProfileRuntimeTests: XCTestCase {
    func testUniversalLinkAndCustomSchemeAcceptOnlyCanonicalOpaqueTokens() throws {
        let parser = PCAEnrollmentLinkParser()
        let token = String(repeating: "A", count: 43)

        let universal = parser.parse(URL(string: "https://www.pcasafe.com/enroll/\(token)")!)
        XCTAssertEqual(universal?.rawInvitationToken, token)
        XCTAssertEqual(universal?.serverBaseURL.absoluteString, "https://www.pcasafe.com")
        let explicitDefaultPort = parser.parse(URL(string: "https://www.pcasafe.com:443/enroll/\(token)")!)
        XCTAssertEqual(explicitDefaultPort?.rawInvitationToken, token)
        XCTAssertEqual(explicitDefaultPort?.serverBaseURL.absoluteString, "https://www.pcasafe.com")

        let custom = parser.parse(URL(string: "pca://enroll?token=\(token)")!)
        XCTAssertEqual(custom?.rawInvitationToken, token)
        XCTAssertEqual(custom?.serverBaseURL.absoluteString, "pca://enroll")

        XCTAssertNil(parser.parse(URL(string: "https://evil.example/enroll/\(token)")!))
        XCTAssertNil(parser.parse(URL(string: "https://www.pcasafe.com/enroll/\(token)?other=child")!))
        XCTAssertNil(parser.parse(URL(string: "https://www.pcasafe.com/\(token)")!))
        XCTAssertNil(parser.parse(URL(string: "https://www.pcasafe.com/invite/\(token)")!))
        XCTAssertNil(parser.parse(URL(string: "pca://enroll?token=short")!))
        XCTAssertNil(parser.parse(URL(string: "https://www.pcasafe.com/enroll/\(token)/")!))
        XCTAssertNil(parser.parse(URL(string: "https://www.pcasafe.com:8443/enroll/\(token)")!))
        XCTAssertNil(parser.parse(URL(string: "https://user@www.pcasafe.com/enroll/\(token)")!))
        XCTAssertNil(parser.parse(URL(string: "https://www.pcasafe.com/enroll/\(token)?")!))
        XCTAssertNil(parser.parse(URL(string: "https://www.pcasafe.com/enroll/\(token.replacingOccurrences(of: "A", with: "%41"))")!))
        XCTAssertNil(parser.parse(URL(string: "https://enroll.pca.app/enroll/\(token)")!))
        XCTAssertNil(parser.parse(URL(string: "pca://enroll:8443?token=\(token)")!))
        XCTAssertNil(parser.parse(URL(string: "pca://user@enroll?token=\(token)")!))
        XCTAssertNil(parser.parse(URL(string: "pca://enroll?token=\(token)&token=\(token)")!))
        XCTAssertNil(parser.parse(URL(string: "pca://enroll?other=x&token=\(token)")!))
        XCTAssertNil(parser.parse(URL(string: "pca://enroll?token=%41\(token.dropFirst())")!))
        XCTAssertNil(parser.parse(URL(string: "https://www.pcasafe.com.evil.example/enroll/\(token)")!))
        XCTAssertNil(parser.parse(URL(string: "https://www.pcasafe.com/enroll/\(String(repeating: "A", count: 44))")!))

        let router = PCAEnrollmentLinkRouter()
        let first = URL(string: "https://www.pcasafe.com/enroll/\(token)")!
        let other = URL(string: "https://www.pcasafe.com/enroll/\(String(repeating: "B", count: 43))")!
        XCTAssertTrue(router.receive(first))
        let expected = try XCTUnwrap(parser.parse(first))
        let different = try XCTUnwrap(parser.parse(other))
        XCTAssertFalse(router.takePendingLink(ifEqualTo: different))
        XCTAssertEqual(router.pendingLink, expected)
        XCTAssertTrue(router.takePendingLink(ifEqualTo: expected))
        XCTAssertNil(router.pendingLink)

        XCTAssertTrue(router.receive(first))
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
    func testEvaluationClockMustUseScheduleEnginesSupportedDateRange() throws {
        for timestamp in [-8_640_000_000_001.0, 8_640_000_000_001.0] {
            XCTAssertThrowsError(try DeviceActivityScheduleMapper.boundaryTriggers(
                for: policy(), now: Date(timeIntervalSince1970: timestamp))) {
                XCTAssertEqual($0 as? DeviceActivityBoundaryPlanError, .malformedBoundary)
            }
        }
        for timestamp in [-8_640_000_000_000.0, 8_640_000_000_000.0] {
            XCTAssertNoThrow(try DeviceActivityScheduleMapper.boundaryTriggers(
                for: policy(), now: Date(timeIntervalSince1970: timestamp)))
        }
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
#if canImport(DeviceActivity)
    func testWindowScheduleComponentsUseTheAuthoredCalendarAndTimezone() {
        let zone = TimeZone(identifier: "America/New_York")!
        let schedule = DeviceActivityScheduleMapper.schedule(for: window("authored-zone",
            .init(hour: 22, minute: 15), .init(hour: 6, minute: 45), zone: zone.identifier))

        XCTAssertEqual(schedule.intervalStart.calendar?.identifier, .gregorian)
        XCTAssertEqual(schedule.intervalEnd.calendar?.identifier, .gregorian)
        XCTAssertEqual(schedule.intervalStart.timeZone?.identifier, zone.identifier)
        XCTAssertEqual(schedule.intervalEnd.timeZone?.identifier, zone.identifier)
        XCTAssertEqual(schedule.intervalStart.hour, 22)
        XCTAssertEqual(schedule.intervalStart.minute, 15)
        XCTAssertEqual(schedule.intervalEnd.hour, 6)
        XCTAssertEqual(schedule.intervalEnd.minute, 45)
        XCTAssertTrue(schedule.repeats)
    }
#endif
}
