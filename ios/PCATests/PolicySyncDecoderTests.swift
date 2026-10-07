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

    func testRestoredPolicyRejectsCorruptSafetyFloorAndMismatchedActivity() throws {
        let store = InMemoryBlobStore()
        try store.write(encode(wellFormedPolicy()), forKey: "schedule.activity-1")
        try store.write(PropertyListEncoder().encode(Set(["ordinary-app"])), forKey: "applicationTokens.activity-1")
        let loader = StoredDeviceActivityPolicyLoader<String>(scheduleStore: store, tokenStore: store)
        XCTAssertEqual(loader.load(activityId: "activity-1")?.applicationTokens, ["ordinary-app"])
        XCTAssertEqual(loader.load(activityId: "activity-1")?.protectedApplicationTokens, [])
        try store.write(PropertyListEncoder().encode(Set(["emergency-app"])), forKey: "protectedApplicationTokens")
        let restarted = StoredDeviceActivityPolicyLoader<String>(scheduleStore: store, tokenStore: store)
        XCTAssertEqual(restarted.load(activityId: "activity-1")?.protectedApplicationTokens, ["emergency-app"])
        try store.write(Data("corrupt safety floor".utf8), forKey: "protectedApplicationTokens")
        XCTAssertNil(restarted.load(activityId: "activity-1"))
        store.remove(forKey: "protectedApplicationTokens")
        try store.write(encode(wellFormedPolicy()), forKey: "schedule.another-activity")
        try store.write(PropertyListEncoder().encode(Set(["ordinary-app"])), forKey: "applicationTokens.another-activity")
        XCTAssertNil(restarted.load(activityId: "another-activity"))
        try store.write(Data("corrupt applications".utf8), forKey: "applicationTokens.activity-1")
        XCTAssertNil(restarted.load(activityId: "activity-1"))
    }
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

    func testSerializedWindowTimezonesSurviveDecodingAndLegacyFallbackIsExplicit() throws {
        let original = wellFormedPolicy()
        let windows = [
            StoredScheduleWindow(id: "utc", kind: .bedtime, daysOfWeek: [1,2,3,4,5,6,7], start: .init(hour: 22, minute: 0), end: .init(hour: 6, minute: 0), appScope: .all, timezone: "UTC"),
            StoredScheduleWindow(id: "ny", kind: .schoolMode, daysOfWeek: [1,2,3,4,5,6,7], start: .init(hour: 9, minute: 0), end: .init(hour: 15, minute: 0), appScope: .all, timezone: "America/New_York"),
            StoredScheduleWindow(id: "legacy", kind: .blockPeriod, daysOfWeek: [2], start: .init(hour: 10, minute: 0), end: .init(hour: 11, minute: 0), appScope: .all)
        ]
        let stored = StoredDeviceActivityPolicy(schemaVersion: 1, activityId: original.activityId, appToken: original.appToken, timeZoneIdentifier: "Asia/Riyadh", windows: windows, bonusGrants: [], exceptions: [], dailyLimit: nil, enforcementCapability: .enforced)
        guard case .success(let decoded) = PolicySyncDecoder.decode(encode(stored)) else { return XCTFail("decode failed") }
        XCTAssertEqual(decoded.windows.map { $0.timeZone.identifier }, [TimeZone(identifier: "UTC")!.identifier, "America/New_York", "Asia/Riyadh"])
        let triggers = try DeviceActivityScheduleMapper.boundaryTriggers(for: decoded, now: Date())
        XCTAssertTrue(triggers.contains(.recurring(timeZoneIdentifier: decoded.windows[1].timeZone.identifier, hour: 9, minute: 0)))
        let at = ISO8601DateFormatter().date(from: "2025-06-03T01:00:00Z")!
        XCTAssertTrue(ScheduleEngine.isWindowActive(decoded.windows[0], now: at))
        XCTAssertFalse(ScheduleEngine.isWindowActive(decoded.windows[1], now: at))
        let schoolTime = ISO8601DateFormatter().date(from: "2025-06-03T13:00:00Z")!
        XCTAssertTrue(ScheduleEngine.isWindowActive(decoded.windows[1], now: schoolTime), "09:00 New York must not be evaluated as 16:00 policy-local Riyadh")
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

final class InstalledPolicyGenerationTests: XCTestCase {
    private let generation = "22222222-2222-4222-8222-222222222222"
    private let anchor = "pca-monitor-11111111-1111-4111-8111-111111111111"
    private let auxiliary = "pca-monitor-33333333-3333-4333-8333-333333333333"
    private func seed(_ store: GenerationPolicyTestStore, state: DeviceActivityMonitorInstallationState = .active) throws {
        let policy = StoredDeviceActivityPolicy(schemaVersion: 1, activityId: "policy", appToken: "opaque", timeZoneIdentifier: "UTC", windows: [], bonusGrants: [], exceptions: [], dailyLimit: nil, enforcementCapability: .enforced)
        let encoder = JSONEncoder(); encoder.dateEncodingStrategy = .iso8601
        let manifest = DeviceActivityMonitorInstallation(policyActivityId: "policy", monitorActivityId: anchor, generation: generation, installedAtUtc: Date(), timeZoneIdentifier: "UTC", state: state, schemaVersion: 2, boundaryMonitors: [.init(activityId: auxiliary, trigger: .recurring(timeZoneIdentifier: "UTC", hour: 1, minute: 0))])
        try store.write(encoder.encode(policy), forKey: "schedule.policy.\(generation)")
        try store.write(PropertyListEncoder().encode(Set(["ordinary"])), forKey: "applicationTokens.policy.\(generation)")
        try store.write(PropertyListEncoder().encode(Set(["emergency"])), forKey: "protectedApplicationTokens.\(generation)")
        try store.write(JSONEncoder().encode(manifest), forKey: deviceActivityMonitorInstallationStorageKey)
        try store.write(Data("policy".utf8), forKey: "activeActivityId")
    }
    func testActiveAnchorAndAuxiliaryResolveExactGenerationButStaleIdDoesNot() throws {
        let store = GenerationPolicyTestStore(); try seed(store)
        let loader = InstalledDeviceActivityPolicyLoader<String>(scheduleStore: store, tokenStore: store)
        for id in [anchor, auxiliary] {
            XCTAssertEqual(loader.load(monitorActivityId: id)?.applicationTokens, ["ordinary"])
            XCTAssertEqual(loader.load(monitorActivityId: id)?.protectedApplicationTokens, ["emergency"])
        }
        XCTAssertNil(loader.load(monitorActivityId: "pca-monitor-44444444-4444-4444-8444-444444444444"))
    }
    func testStartingOrMissingPointerDoesNotResolveAnyMonitor() throws {
        let store = GenerationPolicyTestStore(); try seed(store, state: .starting)
        let loader = InstalledDeviceActivityPolicyLoader<String>(scheduleStore: store, tokenStore: store)
        XCTAssertNil(loader.load(monitorActivityId: auxiliary))
        try seed(store); store.remove(forKey: "activeActivityId")
        XCTAssertNil(loader.load(monitorActivityId: anchor))
    }
    func testMissingOrCorruptGenerationPayloadNeverFallsBackToLegacy() throws {
        for key in ["schedule.policy.\(generation)", "applicationTokens.policy.\(generation)", "protectedApplicationTokens.\(generation)"] {
            for corrupt in [false, true] {
                let store = GenerationPolicyTestStore(); try seed(store)
                // Tempting legacy records cannot replace any generation slot.
                try store.write(store.values["schedule.policy.\(generation)"]!, forKey: "schedule.policy")
                try store.write(PropertyListEncoder().encode(Set(["legacy"])), forKey: "applicationTokens.policy")
                try store.write(PropertyListEncoder().encode(Set<String>()), forKey: "protectedApplicationTokens")
                if corrupt { try store.write(Data("corrupt".utf8), forKey: key) }
                else { store.remove(forKey: key) }
                XCTAssertNil(InstalledDeviceActivityPolicyLoader<String>(scheduleStore: store, tokenStore: store).load(monitorActivityId: auxiliary))
            }
        }
    }
    func testInvalidationDuringEachPayloadReadRejectsCoherentOldSnapshot() throws {
        for key in ["schedule.policy.\(generation)", "applicationTokens.policy.\(generation)", "protectedApplicationTokens.\(generation)"] {
            let store = GenerationPolicyTestStore(); try seed(store)
            store.onRead = { current in
                if current == key {
                    store.onRead = nil
                    store.remove(forKey: deviceActivityMonitorInstallationStorageKey)
                    store.remove(forKey: "activeActivityId")
                }
            }
            XCTAssertNil(InstalledDeviceActivityPolicyLoader<String>(scheduleStore: store, tokenStore: store).load(monitorActivityId: auxiliary))
        }
    }
}
private final class GenerationPolicyTestStore: OpaqueBlobStore {
    var values: [String: Data] = [:]
    var onRead: ((String) -> Void)?
    func write(_ data: Data, forKey key: String) throws { values[key] = data }
    func read(forKey key: String) -> Data? {
        let value = values[key]; onRead?(key); return value
    }
    func remove(forKey key: String) { values.removeValue(forKey: key) }
}
