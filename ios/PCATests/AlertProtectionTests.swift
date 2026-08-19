import XCTest
@testable import PCA

final class AlertProtectionTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_700_000_000)

    func testEveryAddendumTriggerProducesAnOpaqueParentAlert() throws {
        let generator = ProtectionAlertGenerator()
        for (index, trigger) in ProtectionAlertTrigger.allCases.enumerated() {
            let alert = try generator.generate(
                alertId: "alert-\(index)", familyId: "family-1", deviceId: trigger == .invitationRedeemed ? nil : "device-1",
                parentDeviceId: "parent-1", trigger: trigger, keyEpoch: 4, generatedAtUtc: now,
                encryptedPayload: Data([0xAA, UInt8(index)]), nonce: Data([0x01, UInt8(index)]), alertsEnabled: true
            )
            XCTAssertEqual(alert?.trigger, trigger)
            XCTAssertEqual(alert?.encryptedPayload, Data([0xAA, UInt8(index)]))
        }
        XCTAssertEqual(ProtectionAlertTrigger.allCases.count, 10)
    }

    func testDisabledAlertsDoNotCreateAnEmptyEvent() throws {
        let alert = try ProtectionAlertGenerator().generate(
            alertId: "alert-1", familyId: "family-1", deviceId: "device-1", parentDeviceId: "parent-1",
            trigger: .timeTampering, keyEpoch: 1, generatedAtUtc: now, encryptedPayload: Data([1]), nonce: Data([2]), alertsEnabled: false
        )
        XCTAssertNil(alert)
    }

    func testDeviceScopedTriggerRequiresDeviceIdentity() {
        XCTAssertThrowsError(try ProtectionAlertGenerator().generate(
            alertId: "alert-1", familyId: "family-1", deviceId: nil, parentDeviceId: "parent-1",
            trigger: .repeatedInvalidPin, keyEpoch: 1, generatedAtUtc: now, encryptedPayload: Data([1]), nonce: Data([2]), alertsEnabled: true
        )) { error in
            XCTAssertEqual(error as? ProtectionAlertGenerationError, .deviceRequired)
        }
    }
}
