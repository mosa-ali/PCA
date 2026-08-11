import XCTest
@testable import PCA

final class LocationCapabilityAdapterTests: XCTestCase {
    func testLocationServicesOffOverridesEverything() {
        let state = LocationCapabilityAdapter.state(
            authorizationStatus: .authorizedAlways, accuracyAuthorization: .fullAccuracy,
            servicesEnabled: false, backgroundGranted: true
        )
        XCTAssertEqual(state, .locationServicesOff)
    }

    func testNotDeterminedMapsToNotConfigured() {
        let state = LocationCapabilityAdapter.state(
            authorizationStatus: .notDetermined, accuracyAuthorization: .fullAccuracy,
            servicesEnabled: true, backgroundGranted: false
        )
        XCTAssertEqual(state, .notConfigured)
    }

    func testDeniedMapsToPermissionDenied() {
        let state = LocationCapabilityAdapter.state(
            authorizationStatus: .denied, accuracyAuthorization: .fullAccuracy,
            servicesEnabled: true, backgroundGranted: false
        )
        XCTAssertEqual(state, .permissionDenied)
    }

    func testWhenInUseWithoutBackgroundGrantIsBackgroundNotGranted() {
        let state = LocationCapabilityAdapter.state(
            authorizationStatus: .authorizedWhenInUse, accuracyAuthorization: .fullAccuracy,
            servicesEnabled: true, backgroundGranted: false
        )
        XCTAssertEqual(state, .backgroundNotGranted)
    }

    func testWhenInUseWithBackgroundGrantIsActive() {
        let state = LocationCapabilityAdapter.state(
            authorizationStatus: .authorizedWhenInUse, accuracyAuthorization: .fullAccuracy,
            servicesEnabled: true, backgroundGranted: true
        )
        XCTAssertEqual(state, .active)
    }

    func testAuthorizedAlwaysWithReducedAccuracyIsApproximate() {
        let state = LocationCapabilityAdapter.state(
            authorizationStatus: .authorizedAlways, accuracyAuthorization: .reducedAccuracy,
            servicesEnabled: true, backgroundGranted: true
        )
        XCTAssertEqual(state, .approximate)
    }

    func testAuthorizedAlwaysWithFullAccuracyIsActive() {
        let state = LocationCapabilityAdapter.state(
            authorizationStatus: .authorizedAlways, accuracyAuthorization: .fullAccuracy,
            servicesEnabled: true, backgroundGranted: true
        )
        XCTAssertEqual(state, .active)
    }
}
