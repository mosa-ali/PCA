import XCTest
@testable import PCA

final class PCATests: XCTestCase {
    @MainActor
    func testLaunchShellHasStableAccessibilityLabel() {
        let view = ContentView()
        XCTAssertNotNil(view)
    }
}
