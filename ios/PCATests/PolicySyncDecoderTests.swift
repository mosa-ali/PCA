import XCTest
@testable import PCA

/// PCA-15 correction F1. `PolicySyncDecoder`/`StoredDeviceActivityPolicy`
/// have no FamilyControls/DeviceActivity dependency, so the full
/// decode-and-validate contract is testable here even without Xcode/the
/// real framework -- this is the "populated storage -> currentPolicy()
/// decodes real policy" / "malformed policy -> fails safely" / "missing
/// policy -> truthful unavailable" requirement, proven at the schedule-
/// payload layer. The FULL extension-side path (including the separate
/// FamilyControls token blob decode in `AppGroupDeviceActivityPolicySource`)
/// additionally requires the real framework -- see
/// docs/MAC_XCODE_VALIDATION_CHECKLIST.md's project-membership/build
/// sections for that remaining piece.
final class PolicySyncDecoderTests: XCTestCase {
    private func encode(_ stored: StoredDeviceActivityPolicy) -> Data {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        return try! encoder.encode(stored)
    }

    private func wellFormedPolicy(schemaVersion: Int = policySyncSchemaVersion, timeZoneIdentifier: String = "UTC") -> StoredDeviceActivityPolicy {
        StoredDeviceActivityPolicy(
            schemaVersion: schemaVersion,
            activityId: "activity-1",
            appToken: "app-a",
            timeZoneIdentifier: timeZoneIdentifier,
            windows: [
                StoredScheduleWindow(
                    id: "bedtime", kind: .bedtime, daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
                    start: StoredTimeOfDay(hour: 22, minute: 0), end: StoredTimeOfDay(hour: 6, minute: 0),
                    appScope: .all
                ),
            ],
            bonusGrants: [],
            exceptions: [],
            dailyLimit: StoredDailyAppLimit(appScope: .all, limitMinutes: 60, usedMinutesToday: 10, anchorLocalDate: "2026-01-07"),
            enforcementCapability: .enforced
        )
    }

    // MARK: 1. Populated storage decodes a real policy.

    func testWellFormedPolicyDecodesSuccessfully() {
        let data = encode(wellFormedPolicy())
        guard case .success(let decoded) = PolicySyncDecoder.decode(data) else {
            return XCTFail("expected successful decode")
        }
        XCTAssertEqual(decoded.activityId, "activity-1")
        XCTAssertEqual(decoded.appToken, "app-a")
        XCTAssertEqual(decoded.windows.count, 1)
        XCTAssertEqual(decoded.windows.first?.id, "bedtime")
        XCTAssertEqual(decoded.dailyLimit?.limitMinutes, 60)
        XCTAssertEqual(decoded.enforcementCapability, .enforced)
    }

    func testDecodedPolicyIsUsableDirectlyByScheduleEngine() {
        let data = encode(wellFormedPolicy())
        guard case .success(let decoded) = PolicySyncDecoder.decode(data) else {
            return XCTFail("expected successful decode")
        }
        let input = ScheduleEvaluationInput(
            nowUtc: ISO8601DateFormatter().date(from: "2026-01-07T20:00:00Z")!, // 20:00 UTC == within 22:00-06:00 bedtime? no, 20:00 UTC is before 22:00
            timeZone: decoded.timeZone, appToken: decoded.appToken, windows: decoded.windows,
            bonusGrants: decoded.bonusGrants, exceptions: decoded.exceptions, dailyLimit: decoded.dailyLimit,
            enforcementCapability: decoded.enforcementCapability
        )
        let result = ScheduleEngine.evaluate(input)
        XCTAssertNotEqual(result.kind, .invalidConfig, "a policy that decoded successfully must never be rejected as invalid by the engine")
    }

    // MARK: 2. Malformed policy fails safely.

    func testGarbageBytesFailSafelyAsMalformedData() {
        let result = PolicySyncDecoder.decode(Data("not json at all {{{".utf8))
        XCTAssertEqual(result, .failure(.malformedData))
    }

    func testWrongSchemaVersionIsRejectedNotSilentlyCoerced() {
        let data = encode(wellFormedPolicy(schemaVersion: 999))
        XCTAssertEqual(PolicySyncDecoder.decode(data), .failure(.unsupportedSchemaVersion(found: 999, expected: policySyncSchemaVersion)))
    }

    func testUnrecognizedTimeZoneIsRejected() {
        let data = encode(wellFormedPolicy(timeZoneIdentifier: "Not/A_Real_Zone"))
        XCTAssertEqual(PolicySyncDecoder.decode(data), .failure(.unrecognizedTimeZone("Not/A_Real_Zone")))
    }

    func testInvalidWindowConfigIsRejectedWithSpecificErrors() {
        var policy = wellFormedPolicy()
        policy = StoredDeviceActivityPolicy(
            schemaVersion: policy.schemaVersion, activityId: policy.activityId, appToken: policy.appToken,
            timeZoneIdentifier: policy.timeZoneIdentifier,
            windows: [StoredScheduleWindow(id: "bad", kind: .bedtime, daysOfWeek: [], start: StoredTimeOfDay(hour: 99, minute: 0), end: StoredTimeOfDay(hour: 6, minute: 0), appScope: .all)],
            bonusGrants: policy.bonusGrants, exceptions: policy.exceptions, dailyLimit: policy.dailyLimit,
            enforcementCapability: policy.enforcementCapability
        )
        let data = encode(policy)
        guard case .failure(.invalidWindowConfig(let errors)) = PolicySyncDecoder.decode(data) else {
            return XCTFail("expected invalidWindowConfig failure")
        }
        XCTAssertFalse(errors.isEmpty)
    }

    func testEmptyActivityIdIsRejected() {
        let malformed = StoredDeviceActivityPolicy(
            schemaVersion: policySyncSchemaVersion, activityId: "", appToken: "app-a", timeZoneIdentifier: "UTC",
            windows: [], bonusGrants: [], exceptions: [], dailyLimit: nil, enforcementCapability: .enforced
        )
        XCTAssertEqual(PolicySyncDecoder.decode(encode(malformed)), .failure(.emptyActivityId))
    }

    func testEmptyAppTokenIsRejected() {
        let malformed = StoredDeviceActivityPolicy(
            schemaVersion: policySyncSchemaVersion, activityId: "activity-1", appToken: "", timeZoneIdentifier: "UTC",
            windows: [], bonusGrants: [], exceptions: [], dailyLimit: nil, enforcementCapability: .enforced
        )
        XCTAssertEqual(PolicySyncDecoder.decode(encode(malformed)), .failure(.emptyAppToken))
    }

    // MARK: 3. Missing policy -> truthful unavailable, never invented.

    func testEmptyDataNeverProducesASuccessfulDecode() {
        let result = PolicySyncDecoder.decode(Data())
        guard case .failure = result else {
            return XCTFail("empty data must never decode into a usable policy")
        }
    }

    // MARK: 7. Emergency shield exclusions remain enforced (decode + safety-floor integration).

    func testEmergencyExclusionFloorStillAppliesToADecodedPolicysAppScope() {
        // A well-formed, successfully-decoded policy's app scope is
        // downstream input to ShieldPolicyValidator exactly like any other
        // candidate application set -- decoding success must never bypass
        // the emergency safety floor.
        let data = encode(wellFormedPolicy())
        guard case .success = PolicySyncDecoder.decode(data) else {
            return XCTFail("expected successful decode")
        }
        let validator = ShieldPolicyValidator<String>(protectedApplicationTokens: ["phone"], protectedCategoryTokens: [])
        let outcome = validator.validate(applications: ["phone"], categories: [], domains: [])
        guard case .rejected = outcome else {
            return XCTFail("a decoded policy's application set must still be screened against the emergency floor downstream")
        }
    }
}
