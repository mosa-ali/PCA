import XCTest
@testable import PCA

final class FakeAuthorizationStatusSource: AuthorizationStatusSource {
    var status: RawAuthorizationStatus = .notDetermined
    var requestShouldThrow = false

    func currentRawStatus() -> RawAuthorizationStatus { status }

    func requestChildAuthorization() async throws {
        if requestShouldThrow {
            struct EntitlementUnavailable: Error {}
            throw EntitlementUnavailable()
        }
        status = .approved
    }
}

final class ChildAuthorizationCenterTests: XCTestCase {
    private func makeCenter(source: AuthorizationStatusSource) -> ChildAuthorizationCenter {
        ChildAuthorizationCenter(source: source,
            observationStore: InMemoryChildAuthorizationObservationStore())
    }

    func testNotDeterminedIsReportedAsIs() {
        let source = FakeAuthorizationStatusSource()
        let center = makeCenter(source: source)
        XCTAssertEqual(center.refresh(), .notDetermined)
    }

    func testApprovedIsReportedAsIs() {
        let source = FakeAuthorizationStatusSource()
        source.status = .approved
        let center = makeCenter(source: source)
        XCTAssertEqual(center.refresh(), .approved)
    }

    func testRevocationFromApprovedToDeniedIsSurfacedAsRevoked() {
        let source = FakeAuthorizationStatusSource()
        source.status = .approved
        let center = makeCenter(source: source)
        XCTAssertEqual(center.refresh(), .approved)

        source.status = .denied
        XCTAssertEqual(center.refresh(), .revoked(to: .denied))
    }

    func testRevocationFromApprovedToNotDeterminedIsSurfacedAsRevoked() {
        let source = FakeAuthorizationStatusSource()
        source.status = .approved
        let center = makeCenter(source: source)
        XCTAssertEqual(center.refresh(), .approved)

        source.status = .notDetermined
        XCTAssertEqual(center.refresh(), .revoked(to: .notDetermined))
    }

    func testSecondConsecutiveNonApprovedObservationIsNotReportedAsANewRevocation() {
        // A revocation event should fire exactly once at the transition,
        // not on every subsequent poll while still non-approved.
        let source = FakeAuthorizationStatusSource()
        source.status = .approved
        let center = makeCenter(source: source)
        _ = center.refresh()

        source.status = .denied
        XCTAssertEqual(center.refresh(), .revoked(to: .denied))
        XCTAssertEqual(center.refresh(), .denied, "the second read of an unchanged denied status is plain .denied, not another .revoked")
    }

    func testEntitlementUnavailableSurfacesOnThrownRequest() async {
        let source = FakeAuthorizationStatusSource()
        source.requestShouldThrow = true
        let center = makeCenter(source: source)
        let result = await center.requestAuthorization()
        XCTAssertEqual(result, .entitlementUnavailable)
    }

    func testSuccessfulRequestReflectsApprovedState() async {
        let source = FakeAuthorizationStatusSource()
        let center = makeCenter(source: source)
        let result = await center.requestAuthorization()
        XCTAssertEqual(result, .approved)
    }

    func testRevocationWhileProcessStoppedIsSurfacedAfterRestart() {
        let persisted = InMemoryChildAuthorizationObservationStore()
        let approvedSource = FakeAuthorizationStatusSource()
        approvedSource.status = .approved
        XCTAssertEqual(ChildAuthorizationCenter(source: approvedSource, observationStore: persisted).refresh(), .approved)

        let revokedSource = FakeAuthorizationStatusSource()
        revokedSource.status = .denied
        let restartedCenter = ChildAuthorizationCenter(source: revokedSource, observationStore: persisted)
        XCTAssertEqual(restartedCenter.refresh(), .revoked(to: .denied),
            "the persisted prior approval must surface a revocation that happened while the app process was stopped")
        XCTAssertEqual(restartedCenter.refresh(), .denied,
            "persisting the current status prevents the same revocation from being reported repeatedly")
    }

    func testUserDefaultsAdapterPreservesPriorApprovalAcrossStoreRecreation() throws {
        let suiteName = "pca.authorization.restart.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        defer { defaults.removePersistentDomain(forName: suiteName) }
        let key = "test.authorization.status"

        let approvedSource = FakeAuthorizationStatusSource()
        approvedSource.status = .approved
        let firstStore = UserDefaultsChildAuthorizationObservationStore(defaults: defaults, key: key)
        XCTAssertEqual(ChildAuthorizationCenter(source: approvedSource, observationStore: firstStore).refresh(), .approved)

        let deniedSource = FakeAuthorizationStatusSource()
        deniedSource.status = .denied
        let reopenedStore = UserDefaultsChildAuthorizationObservationStore(defaults: defaults, key: key)
        XCTAssertEqual(ChildAuthorizationCenter(source: deniedSource, observationStore: reopenedStore).refresh(), .revoked(to: .denied))
    }

    func testIndependentCentersShareOneRevocationTransition() {
        let persisted = InMemoryChildAuthorizationObservationStore(status: .approved)
        let deniedSource = FakeAuthorizationStatusSource()
        deniedSource.status = .denied

        let firstCenter = ChildAuthorizationCenter(source: deniedSource, observationStore: persisted)
        let secondCenter = ChildAuthorizationCenter(source: deniedSource, observationStore: persisted)
        XCTAssertEqual(firstCenter.refresh(), .revoked(to: .denied))
        XCTAssertEqual(secondCenter.refresh(), .denied,
            "a second coordinator observes the already-recorded raw state instead of emitting a duplicate transition")
    }

    func testCorruptPersistedObservationIsDiscardedAndLiveStatusWins() throws {
        let suiteName = "pca.authorization.test.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        defer { defaults.removePersistentDomain(forName: suiteName) }
        let key = "test.authorization.status"
        defaults.set("GRANTED", forKey: key)
        let store = UserDefaultsChildAuthorizationObservationStore(defaults: defaults, key: key)

        XCTAssertNil(store.loadLastObservedStatus())
        XCTAssertNil(defaults.object(forKey: key), "unrecognized persisted status is cleared rather than trusted")
        defaults.set(7, forKey: key)
        XCTAssertNil(store.loadLastObservedStatus())
        XCTAssertNil(defaults.object(forKey: key), "a value with the wrong persisted type is cleared")
        let source = FakeAuthorizationStatusSource()
        source.status = .denied
        XCTAssertEqual(ChildAuthorizationCenter(source: source, observationStore: store).refresh(), .denied)
    }

    func testOnlyApprovedPermitsEnforcement() {
        XCTAssertTrue(ChildAuthorizationState.approved.permitsEnforcement)
        XCTAssertFalse(ChildAuthorizationState.notDetermined.permitsEnforcement)
        XCTAssertFalse(ChildAuthorizationState.denied.permitsEnforcement)
        XCTAssertFalse(ChildAuthorizationState.entitlementUnavailable.permitsEnforcement)
        XCTAssertFalse(ChildAuthorizationState.revoked(to: .denied).permitsEnforcement)
    }
}
