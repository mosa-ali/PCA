import XCTest
@testable import PCA

private final class CorruptibleEnrollmentProfileStore: PCAEnrollmentProfileStore {
    var profile: PCAEnrollmentProfile?
    var loadFails = false

    func save(_ profile: PCAEnrollmentProfile, forDeviceId deviceId: String) throws {
        self.profile = profile
    }

    func load(forDeviceId deviceId: String) throws -> PCAEnrollmentProfile? {
        if loadFails { throw PCAEnrollmentProfileStoreError.invalidStoredProfile }
        return profile
    }

    func remove(forDeviceId deviceId: String) throws {
        profile = nil
    }
}

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

    func testRestoreWithoutPersistedProfileClearsPreviouslyConfirmedMemoryState() throws {
        let deviceId = "opaque-device"
        let store = InMemoryPCAEnrollmentProfileStore()
        let controller = PCAEnrollmentProfileRuntimeController(
            deviceId: deviceId,
            store: store,
            authorization: .notDetermined
        )
        controller.receiveParentAuthorizedProfile(PCAEnrollmentProfile(
            childProfileId: "opaque-child",
            ageUxTier: .teen,
            initialPolicyProfile: .balanced
        ))
        guard case .authorizationRequired = controller.confirmChildProfile() else {
            return XCTFail("unapproved profile should be stored but remain gated")
        }

        try store.remove(forDeviceId: deviceId)
        XCTAssertEqual(controller.restorePersistedProfile(), .awaitingProfile)
        XCTAssertEqual(controller.updateAuthorization(.approved), .awaitingProfile,
            "authorization callbacks must not resurrect a profile absent from durable storage")
    }

    func testRestoreFailureClearsPreviouslyConfirmedMemoryState() {
        let deviceId = "opaque-device"
        let store = CorruptibleEnrollmentProfileStore()
        let controller = PCAEnrollmentProfileRuntimeController(
            deviceId: deviceId,
            store: store,
            authorization: .notDetermined
        )
        controller.receiveParentAuthorizedProfile(PCAEnrollmentProfile(
            childProfileId: "opaque-child",
            ageUxTier: .teen,
            initialPolicyProfile: .balanced
        ))
        guard case .authorizationRequired = controller.confirmChildProfile() else {
            return XCTFail("unapproved profile should be stored but remain gated")
        }

        store.loadFails = true
        XCTAssertEqual(controller.restorePersistedProfile(), .profilePersistenceFailed)
        XCTAssertEqual(controller.updateAuthorization(.approved), .profilePersistenceFailed,
            "authorization callbacks must not revive a profile after corrupt/unavailable restoration")
    }

    func testEnrollmentProfileStoreRejectsInvalidPersistedIdentityAndReadBacksWrites() throws {
        let suite = "org.pca.tests.enrollment.profile.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let store = UserDefaultsPCAEnrollmentProfileStore(defaults: defaults, namespace: "test.profile")
        let valid = PCAEnrollmentProfile(childProfileId: "opaque-child", ageUxTier: .teen, initialPolicyProfile: .balanced)

        try store.save(valid, forDeviceId: "device-a")
        XCTAssertEqual(try store.load(forDeviceId: "device-a"), valid)

        let invalid = PCAEnrollmentProfile(childProfileId: String(repeating: "x", count: 129),
            ageUxTier: .teen, initialPolicyProfile: .balanced)
        XCTAssertThrowsError(try store.save(invalid, forDeviceId: "device-a")) {
            XCTAssertEqual($0 as? PCAEnrollmentProfileStoreError, .invalidStoredProfile)
        }
        XCTAssertEqual(try store.load(forDeviceId: "device-a"), valid,
            "rejecting malformed replacement must preserve the confirmed profile")

        defaults.set(try JSONEncoder().encode(invalid), forKey: "test.profile.device-b")
        XCTAssertThrowsError(try store.load(forDeviceId: "device-b")) {
            XCTAssertEqual($0 as? PCAEnrollmentProfileStoreError, .invalidStoredProfile)
        }
        defaults.set(Data(repeating: 0x41, count: 2_049), forKey: "test.profile.device-c")
        XCTAssertThrowsError(try store.load(forDeviceId: "device-c")) {
            XCTAssertEqual($0 as? PCAEnrollmentProfileStoreError, .invalidStoredProfile)
        }
    }

    func testEnrollmentProfileStoreRejectsDirectAndEscapedDuplicateMembers() throws {
        let suite = "org.pca.tests.enrollment.duplicate-members.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let store = UserDefaultsPCAEnrollmentProfileStore(defaults: defaults, namespace: "test.profile")
        let profile = PCAEnrollmentProfile(childProfileId: "opaque-child", ageUxTier: .teen, initialPolicyProfile: .balanced)
        let encoded = try XCTUnwrap(String(data: JSONEncoder().encode(profile), encoding: .utf8))
        let originalMember = #""ageUxTier":"TEEN""#
        XCTAssertTrue(encoded.contains(originalMember), "fixture uses the synthesized ageUxTier member")
        let duplicateFixtures = [
            encoded.replacingOccurrences(of: originalMember,
                with: #""ageUxTier":"TEEN","ageUxTier":"YOUNG_CHILD""#),
            encoded.replacingOccurrences(of: originalMember,
                with: #""ageUxTier":"TEEN","ageUx\u0054ier":"YOUNG_CHILD""#),
        ]

        for fixture in duplicateFixtures {
            defaults.set(Data(fixture.utf8), forKey: "test.profile.device-duplicate")
            XCTAssertThrowsError(try store.load(forDeviceId: "device-duplicate")) {
                XCTAssertEqual($0 as? PCAEnrollmentProfileStoreError, .invalidStoredProfile)
            }
        }
    }
}
