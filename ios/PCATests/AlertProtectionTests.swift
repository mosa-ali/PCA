import XCTest
@testable import PCA

final class AlertProtectionTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_700_000_000)
    private func generate(
        alertId: String = "alert-1", familyId: String = "family-1", deviceId: String? = "device-1",
        parentDeviceId: String = "parent-1", generatedAtUtc: Date? = nil,
        encryptedPayload: Data = Data([1]), nonce: Data = Data([2])
    ) throws -> E2EEProtectionAlert? {
        try ProtectionAlertGenerator().generate(alertId: alertId, familyId: familyId, deviceId: deviceId,
            parentDeviceId: parentDeviceId, trigger: .timeTampering, keyEpoch: 1,
            generatedAtUtc: generatedAtUtc ?? now, encryptedPayload: encryptedPayload, nonce: nonce, alertsEnabled: true)
    }

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

    func testKeyEpochAcceptsInt32MaximumAndPreservesZero() throws {
        let generator = ProtectionAlertGenerator()
        let maximum = try generator.generate(
            alertId: "alert-max", familyId: "family-1", deviceId: "device-1", parentDeviceId: "parent-1",
            trigger: .timeTampering, keyEpoch: ProtectionAlertGenerator.maxSupportedKeyEpoch,
            generatedAtUtc: now, encryptedPayload: Data([1]), nonce: Data([2]), alertsEnabled: true
        )
        let zero = try generator.generate(
            alertId: "alert-zero", familyId: "family-1", deviceId: "device-1", parentDeviceId: "parent-1",
            trigger: .timeTampering, keyEpoch: 0,
            generatedAtUtc: now, encryptedPayload: Data([1]), nonce: Data([2]), alertsEnabled: true
        )

        XCTAssertEqual(maximum?.keyEpoch, Int(Int32.max))
        XCTAssertEqual(zero?.keyEpoch, 0)
    }

    func testKeyEpochAboveInt32MaximumIsRejected() {
        XCTAssertThrowsError(try ProtectionAlertGenerator().generate(
            alertId: "alert-overflow", familyId: "family-1", deviceId: "device-1", parentDeviceId: "parent-1",
            trigger: .timeTampering, keyEpoch: Int(Int32.max) + 1,
            generatedAtUtc: now, encryptedPayload: Data([1]), nonce: Data([2]), alertsEnabled: true
        )) { error in
            XCTAssertEqual(error as? ProtectionAlertGenerationError, .invalidKeyEpoch)
        }
    }

    func testDeviceScopedTriggerRequiresDeviceIdentity() {
        XCTAssertThrowsError(try ProtectionAlertGenerator().generate(
            alertId: "alert-1", familyId: "family-1", deviceId: nil, parentDeviceId: "parent-1",
            trigger: .repeatedInvalidPin, keyEpoch: 1, generatedAtUtc: now, encryptedPayload: Data([1]), nonce: Data([2]), alertsEnabled: true
        )) { error in
            XCTAssertEqual(error as? ProtectionAlertGenerationError, .deviceRequired)
        }
    }

    func testOpaqueIdentifiersUseBackendBoundsIncludingOptionalDeviceId() {
        for attempt in [
            { try self.generate(alertId: "") },
            { try self.generate(familyId: String(repeating: "a", count: 129)) },
            { try self.generate(parentDeviceId: String(repeating: "😀", count: 65)) },
            { try self.generate(deviceId: "") },
            { try self.generate(deviceId: String(repeating: "d", count: 129)) },
        ] {
            XCTAssertThrowsError(try attempt()) { error in
                XCTAssertEqual(error as? ProtectionAlertGenerationError, .invalidOpaqueIdentifier)
            }
        }
        XCTAssertNoThrow(try ProtectionAlertGenerator().generate(
            alertId: "alert-1", familyId: "family-1", deviceId: nil, parentDeviceId: "parent-1",
            trigger: .invitationRedeemed, keyEpoch: 1, generatedAtUtc: now,
            encryptedPayload: Data([1]), nonce: Data([2]), alertsEnabled: true))
        XCTAssertNoThrow(try generate(deviceId: String(repeating: "d", count: 128)))
    }

    func testGeneratedTimestampMustBeFiniteAndInsideJavaScriptDateRange() {
        for timestamp in [Double.nan, .infinity, -.infinity, 8_640_000_000_001, -8_640_000_000_001] {
            XCTAssertThrowsError(try generate(generatedAtUtc: Date(timeIntervalSince1970: timestamp))) { error in
                XCTAssertEqual(error as? ProtectionAlertGenerationError, .invalidGeneratedAtUtc)
            }
        }
        XCTAssertNoThrow(try generate(generatedAtUtc: Date(timeIntervalSince1970: 8_640_000_000_000)))
        XCTAssertNoThrow(try generate(generatedAtUtc: Date(timeIntervalSince1970: -8_640_000_000_000)))
    }

    func testEncryptedPayloadAndNonceMatchBackendByteBounds() throws {
        XCTAssertNoThrow(try generate(encryptedPayload: Data(repeating: 1, count: 16 * 1024),
            nonce: Data(repeating: 2, count: 64)))
        for attempt in [
            { try self.generate(encryptedPayload: Data(repeating: 1, count: 16 * 1024 + 1)) },
            { try self.generate(nonce: Data(repeating: 2, count: 65)) },
        ] {
            XCTAssertThrowsError(try attempt()) { error in
                XCTAssertEqual(error as? ProtectionAlertGenerationError, .invalidEncryptedPayload)
            }
        }
    }
}
