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
        let degraded = DeviceActivityCallbackHealth.degraded(missed: [ExpectedCallback(kind: .intervalDidStart, expectedNoLaterThan: Date())])
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
}
