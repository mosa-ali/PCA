import XCTest
@testable import PCA

final class EnrollmentProfileTests: XCTestCase {
    func testConfiguredAgeTierBreakDefaultsRemainSafeAndCanBeStricter() {
        let configuration = PCAEnrollmentDefaultsConfiguration(
            balancedActiveUseThresholdMinutes: 60,
            strictActiveUseThresholdMinutes: 45,
            balancedBreakDurationMinutes: 30,
            strictBreakDurationMinutes: 45
        )
        let consumer = PCAEnrollmentProfileConsumer(configuration: configuration)

        let teenBalanced = consumer.defaults(for: PCAEnrollmentProfile(
            childProfileId: nil,
            ageUxTier: .teen,
            initialPolicyProfile: .balanced
        ))
        let youngChild = consumer.defaults(for: PCAEnrollmentProfile(
            childProfileId: nil,
            ageUxTier: .youngChild,
            initialPolicyProfile: .balanced
        ))

        XCTAssertEqual(teenBalanced.breakDurationMinutes, 30)
        XCTAssertEqual(youngChild.breakDurationMinutes, 45)
        XCTAssertEqual(youngChild.contentFilterDefault, .strict)
    }

    func testUnsafeConfigurationFallsBackToTheNonWeakenableBaseline() {
        let unsafe = PCAEnrollmentDefaultsConfiguration(
            balancedActiveUseThresholdMinutes: 90,
            strictActiveUseThresholdMinutes: 60,
            balancedBreakDurationMinutes: 15,
            strictBreakDurationMinutes: 15
        )
        let consumer = PCAEnrollmentProfileConsumer(configuration: unsafe)
        let defaults = consumer.defaults(for: PCAEnrollmentProfile(
            childProfileId: nil,
            ageUxTier: .teen,
            initialPolicyProfile: .balanced
        ))

        XCTAssertEqual(consumer.configuration, .baseline)
        XCTAssertEqual(defaults.activeUseThresholdMinutes, 60)
        XCTAssertEqual(defaults.breakDurationMinutes, 30)
    }

    func testYoungChildDisclosureUsesShorterConfirmationCopyWithoutChangingPrivacyScope() {
        let young = PCAEnrollmentDisclosure.forProfile(PCAEnrollmentProfile(
            childProfileId: nil,
            ageUxTier: .youngChild,
            initialPolicyProfile: .balanced
        ))
        let teen = PCAEnrollmentDisclosure.forProfile(PCAEnrollmentProfile(
            childProfileId: nil,
            ageUxTier: .teen,
            initialPolicyProfile: .balanced
        ))

        XCTAssertEqual(young.readingLevel, .simple)
        XCTAssertEqual(teen.readingLevel, .clear)
        XCTAssertLessThan(young.summary.split(separator: " ").count, teen.summary.split(separator: " ").count)
        XCTAssertEqual(young.monitoredSummary, teen.monitoredSummary)
        XCTAssertEqual(young.notMonitoredSummary, teen.notMonitoredSummary)
        XCTAssertEqual(young.emergencySummary, teen.emergencySummary)
    }

    func testProfileConfirmationStillRequiresAppleAuthorizationBeforeRuntimeReady() {
        let controller = PCAEnrollmentProfileRuntimeController(
            deviceId: "opaque-device",
            store: InMemoryPCAEnrollmentProfileStore(),
            authorization: .notDetermined
        )
        controller.receiveParentAuthorizedProfile(PCAEnrollmentProfile(
            childProfileId: "opaque-child",
            ageUxTier: .teen,
            initialPolicyProfile: .balanced
        ))

        guard case .authorizationRequired = controller.confirmChildProfile() else {
            return XCTFail("confirmation must not imply Family Controls approval")
        }
        if case .ready = controller.state {
            XCTFail("an unapproved Family Controls state must not reach runtime-ready")
        }
    }
}
