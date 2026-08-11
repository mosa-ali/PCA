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
    func testNotDeterminedIsReportedAsIs() {
        let source = FakeAuthorizationStatusSource()
        let center = ChildAuthorizationCenter(source: source)
        XCTAssertEqual(center.refresh(), .notDetermined)
    }

    func testApprovedIsReportedAsIs() {
        let source = FakeAuthorizationStatusSource()
        source.status = .approved
        let center = ChildAuthorizationCenter(source: source)
        XCTAssertEqual(center.refresh(), .approved)
    }

    func testRevocationFromApprovedToDeniedIsSurfacedAsRevoked() {
        let source = FakeAuthorizationStatusSource()
        source.status = .approved
        let center = ChildAuthorizationCenter(source: source)
        XCTAssertEqual(center.refresh(), .approved)

        source.status = .denied
        XCTAssertEqual(center.refresh(), .revoked(to: .denied))
    }

    func testRevocationFromApprovedToNotDeterminedIsSurfacedAsRevoked() {
        let source = FakeAuthorizationStatusSource()
        source.status = .approved
        let center = ChildAuthorizationCenter(source: source)
        XCTAssertEqual(center.refresh(), .approved)

        source.status = .notDetermined
        XCTAssertEqual(center.refresh(), .revoked(to: .notDetermined))
    }

    func testSecondConsecutiveNonApprovedObservationIsNotReportedAsANewRevocation() {
        // A revocation event should fire exactly once at the transition,
        // not on every subsequent poll while still non-approved.
        let source = FakeAuthorizationStatusSource()
        source.status = .approved
        let center = ChildAuthorizationCenter(source: source)
        _ = center.refresh()

        source.status = .denied
        XCTAssertEqual(center.refresh(), .revoked(to: .denied))
        XCTAssertEqual(center.refresh(), .denied, "the second read of an unchanged denied status is plain .denied, not another .revoked")
    }

    func testEntitlementUnavailableSurfacesOnThrownRequest() async {
        let source = FakeAuthorizationStatusSource()
        source.requestShouldThrow = true
        let center = ChildAuthorizationCenter(source: source)
        let result = await center.requestAuthorization()
        XCTAssertEqual(result, .entitlementUnavailable)
    }

    func testSuccessfulRequestReflectsApprovedState() async {
        let source = FakeAuthorizationStatusSource()
        let center = ChildAuthorizationCenter(source: source)
        let result = await center.requestAuthorization()
        XCTAssertEqual(result, .approved)
    }

    func testOnlyApprovedPermitsEnforcement() {
        XCTAssertTrue(ChildAuthorizationState.approved.permitsEnforcement)
        XCTAssertFalse(ChildAuthorizationState.notDetermined.permitsEnforcement)
        XCTAssertFalse(ChildAuthorizationState.denied.permitsEnforcement)
        XCTAssertFalse(ChildAuthorizationState.entitlementUnavailable.permitsEnforcement)
        XCTAssertFalse(ChildAuthorizationState.revoked(to: .denied).permitsEnforcement)
    }
}
