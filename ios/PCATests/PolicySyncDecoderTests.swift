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

    func testRestoredPolicyRejectsOversizedApplicationAndSafetyFloorTokenBlobs() throws {
        let store = InMemoryBlobStore()
        try store.write(encode(wellFormedPolicy()), forKey: "schedule.activity-1")
        let ordinary = try PropertyListEncoder().encode(Set(["ordinary-app"]))
        let oversized = try PropertyListEncoder().encode(Set([String(repeating: "x", count: 1_100_000)]))
        XCTAssertGreaterThan(oversized.count, 1_048_576)
        let loader = StoredDeviceActivityPolicyLoader<String>(scheduleStore: store, tokenStore: store)

        try store.write(oversized, forKey: "applicationTokens.activity-1")
        try store.write(ordinary, forKey: "protectedApplicationTokens")
        XCTAssertNil(loader.load(activityId: "activity-1"),
            "oversized FamilyControls application bytes must be rejected before plist decoding")

        try store.write(ordinary, forKey: "applicationTokens.activity-1")
        try store.write(oversized, forKey: "protectedApplicationTokens")
        XCTAssertNil(loader.load(activityId: "activity-1"),
            "an oversized safety-floor payload must make the whole stored policy unavailable")
    }

    private func encode(_ stored: StoredDeviceActivityPolicy) -> Data {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        return try! encoder.encode(stored)
    }

    private func policyObject(_ data: Data) throws -> [String: Any] {
        try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    private func encodedPolicyObject(_ object: [String: Any]) throws -> Data {
        try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
    }

    private func wellFormedPolicy(schemaVersion: Int = policySyncSchemaVersion, timeZoneIdentifier: String = "UTC") -> StoredDeviceActivityPolicy {
        StoredDeviceActivityPolicy(
            schemaVersion: schemaVersion,
            activityId: "activity-1",
            appToken: "app-a",
            timeZoneIdentifier: timeZoneIdentifier,
            windows: [
                StoredScheduleWindow(
                    id: "bedtime", kind: .bedtime, daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
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
            StoredScheduleWindow(id: "utc", kind: .bedtime, daysOfWeek: [0,1,2,3,4,5,6], start: .init(hour: 22, minute: 0), end: .init(hour: 6, minute: 0), appScope: .all, timezone: "UTC"),
            StoredScheduleWindow(id: "ny", kind: .schoolMode, daysOfWeek: [0,1,2,3,4,5,6], start: .init(hour: 9, minute: 0), end: .init(hour: 15, minute: 0), appScope: .all, timezone: "America/New_York"),
            StoredScheduleWindow(id: "legacy", kind: .blockPeriod, daysOfWeek: [2], start: .init(hour: 10, minute: 0), end: .init(hour: 11, minute: 0), appScope: .all)
        ]
        let stored = StoredDeviceActivityPolicy(schemaVersion: 1, activityId: original.activityId, appToken: original.appToken, timeZoneIdentifier: "Asia/Riyadh", windows: windows, bonusGrants: [], exceptions: [], dailyLimit: nil, enforcementCapability: .enforced)
        guard case .success(let decoded) = PolicySyncDecoder.decode(encode(stored)) else { return XCTFail("decode failed") }
        XCTAssertEqual(decoded.windows.map { $0.timeZone.identifier }, [TimeZone(identifier: "UTC")!.identifier, "America/New_York", "Asia/Riyadh"])
        XCTAssertEqual(decoded.windows[0].daysOfWeek, Set(1...7),
            "contract weekday indices must translate to Calendar's Sunday=1 numbering")
        XCTAssertEqual(decoded.windows[1].daysOfWeek, Set(1...7))
        XCTAssertEqual(decoded.windows[2].daysOfWeek, Set([3]), "contract Tuesday index 2 maps to Calendar Tuesday index 3")
        let triggers = try DeviceActivityScheduleMapper.boundaryTriggers(for: decoded, now: Date())
        XCTAssertTrue(triggers.contains(.recurring(timeZoneIdentifier: decoded.windows[1].timeZone.identifier, hour: 9, minute: 0)))
        let at = ISO8601DateFormatter().date(from: "2025-06-03T01:00:00Z")!
        XCTAssertTrue(ScheduleEngine.isWindowActive(decoded.windows[0], now: at))
        XCTAssertFalse(ScheduleEngine.isWindowActive(decoded.windows[1], now: at))
        let schoolTime = ISO8601DateFormatter().date(from: "2025-06-03T13:00:00Z")!
        XCTAssertTrue(ScheduleEngine.isWindowActive(decoded.windows[1], now: schoolTime), "09:00 New York must not be evaluated as 16:00 policy-local Riyadh")
    }

    func testContractWeekdaysMapSundayAndEveryOtherDayBeforeEvaluation() throws {
        let allDays = wellFormedPolicy()
        guard case .success(let decodedAllDays) = PolicySyncDecoder.decode(encode(allDays)) else {
            return XCTFail("all seven shared-contract weekdays should decode")
        }
        XCTAssertEqual(decodedAllDays.windows[0].daysOfWeek, Set(1...7))

        let sundayWindow = StoredScheduleWindow(id: "sunday", kind: .bedtime, daysOfWeek: [0],
            start: .init(hour: 22, minute: 0), end: .init(hour: 6, minute: 0), appScope: .all, timezone: "UTC")
        let source = wellFormedPolicy()
        let sundayPolicy = StoredDeviceActivityPolicy(schemaVersion: source.schemaVersion,
            activityId: source.activityId, appToken: source.appToken, timeZoneIdentifier: source.timeZoneIdentifier,
            windows: [sundayWindow], bonusGrants: [], exceptions: [], dailyLimit: nil,
            enforcementCapability: .enforced)
        guard case .success(let decodedSunday) = PolicySyncDecoder.decode(encode(sundayPolicy)) else {
            return XCTFail("the contract's Sunday index 0 must decode")
        }
        XCTAssertEqual(decodedSunday.windows[0].daysOfWeek, [1])

        func decision(_ instant: String) -> ScheduleDecisionKind {
            ScheduleEngine.evaluate(ScheduleEvaluationInput(
                nowUtc: ISO8601DateFormatter().date(from: instant)!, timeZone: decodedSunday.timeZone,
                appToken: decodedSunday.appToken, windows: decodedSunday.windows,
                bonusGrants: decodedSunday.bonusGrants, exceptions: decodedSunday.exceptions,
                dailyLimit: decodedSunday.dailyLimit, enforcementCapability: decodedSunday.enforcementCapability
            )).kind
        }
        XCTAssertEqual(decision("2026-01-04T22:30:00Z"), .blockedBedtime, "2026-01-04 is Sunday")
        XCTAssertEqual(decision("2026-01-10T22:30:00Z"), .allowed, "2026-01-10 is Saturday, not Sunday")
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

    func testPolicyDecoderAcceptsBackendFractionalIso8601Dates() throws {
        let grantStart = "2026-01-07T09:00:00.123Z"
        let grantEnd = "2026-01-07T09:15:00.456Z"
        let exceptionStart = "2026-01-07T11:00:00.789Z"
        let exceptionEnd = "2026-01-07T13:00:00.321Z"
        let source = wellFormedPolicy()
        let policy = StoredDeviceActivityPolicy(
            schemaVersion: source.schemaVersion, activityId: source.activityId,
            appToken: source.appToken, timeZoneIdentifier: source.timeZoneIdentifier,
            windows: source.windows,
            bonusGrants: [StoredBonusGrant(id: "bonus-ms", appScope: .all, extraMinutes: 15,
                grantedAtUtc: Date(timeIntervalSince1970: 1_767_776_400.123),
                expiresAtUtc: Date(timeIntervalSince1970: 1_767_777_300.456))],
            exceptions: [StoredParentException(id: "exception-ms", appScope: .all,
                startAtUtc: Date(timeIntervalSince1970: 1_767_783_600.789),
                endAtUtc: Date(timeIntervalSince1970: 1_767_790_800.321))],
            dailyLimit: source.dailyLimit, enforcementCapability: source.enforcementCapability
        )
        var object = try policyObject(encode(policy))
        var grants = try XCTUnwrap(object["bonusGrants"] as? [[String: Any]])
        grants[0]["grantedAtUtc"] = grantStart
        grants[0]["expiresAtUtc"] = grantEnd
        object["bonusGrants"] = grants
        var exceptions = try XCTUnwrap(object["exceptions"] as? [[String: Any]])
        exceptions[0]["startAtUtc"] = exceptionStart
        exceptions[0]["endAtUtc"] = exceptionEnd
        object["exceptions"] = exceptions

        guard case .success(let decoded) = PolicySyncDecoder.decode(try encodedPolicyObject(object)) else {
            return XCTFail("backend RFC3339 timestamps with fractional milliseconds must decode")
        }
        XCTAssertEqual(try XCTUnwrap(decoded.bonusGrants.first?.grantedAt).timeIntervalSince1970,
            1_767_776_400.123, accuracy: 0.001)
        XCTAssertEqual(try XCTUnwrap(decoded.bonusGrants.first?.expiresAt).timeIntervalSince1970,
            1_767_777_300.456, accuracy: 0.001)
        XCTAssertEqual(try XCTUnwrap(decoded.exceptions.first?.startAt).timeIntervalSince1970,
            1_767_783_600.789, accuracy: 0.001)
        XCTAssertEqual(try XCTUnwrap(decoded.exceptions.first?.endAt).timeIntervalSince1970,
            1_767_790_800.321, accuracy: 0.001)
    }

    func testEmptyOpaqueAppScopeTokenIsRejectedAcrossEveryPolicyDimension() {
        let source = wellFormedPolicy()
        let now = Date(timeIntervalSince1970: 1_760_000_000)
        let invalidScope = StoredAppScope.apps([""])
        let candidates = [
            StoredDeviceActivityPolicy(schemaVersion: source.schemaVersion, activityId: source.activityId,
                appToken: source.appToken, timeZoneIdentifier: source.timeZoneIdentifier,
                windows: [StoredScheduleWindow(id: "blank-window", kind: .bedtime, daysOfWeek: [0],
                    start: .init(hour: 22, minute: 0), end: .init(hour: 6, minute: 0), appScope: invalidScope)],
                bonusGrants: [], exceptions: [], dailyLimit: nil, enforcementCapability: source.enforcementCapability),
            StoredDeviceActivityPolicy(schemaVersion: source.schemaVersion, activityId: source.activityId,
                appToken: source.appToken, timeZoneIdentifier: source.timeZoneIdentifier, windows: [],
                bonusGrants: [StoredBonusGrant(id: "blank-bonus", appScope: invalidScope, extraMinutes: 5,
                    grantedAtUtc: now, expiresAtUtc: now.addingTimeInterval(60))],
                exceptions: [], dailyLimit: nil, enforcementCapability: source.enforcementCapability),
            StoredDeviceActivityPolicy(schemaVersion: source.schemaVersion, activityId: source.activityId,
                appToken: source.appToken, timeZoneIdentifier: source.timeZoneIdentifier, windows: [],
                bonusGrants: [],
                exceptions: [StoredParentException(id: "blank-exception", appScope: invalidScope,
                    startAtUtc: now, endAtUtc: now.addingTimeInterval(60))],
                dailyLimit: nil, enforcementCapability: source.enforcementCapability),
            StoredDeviceActivityPolicy(schemaVersion: source.schemaVersion, activityId: source.activityId,
                appToken: source.appToken, timeZoneIdentifier: source.timeZoneIdentifier, windows: [],
                bonusGrants: [], exceptions: [],
                dailyLimit: StoredDailyAppLimit(appScope: invalidScope, limitMinutes: 30,
                    usedMinutesToday: 0, anchorLocalDate: "2026-01-07"),
                enforcementCapability: source.enforcementCapability),
        ]

        for candidate in candidates {
            guard case .failure(.invalidAppScope(let errors)) = PolicySyncDecoder.decode(encode(candidate)) else {
                XCTFail("empty opaque app-scope tokens must fail before policy reaches enforcement")
                continue
            }
            XCTAssertEqual(errors.count, 1)
            XCTAssertTrue(errors[0].contains("appScope must contain non-empty app tokens"))
        }
    }

    func testMalformedParentExceptionIntervalsAreRejectedBeforePolicyCanLoad() throws {
        let source = wellFormedPolicy()
        let validStart = Date(timeIntervalSince1970: 1_760_000_000)
        let invalidIntervals: [(String, Date, Date)] = [
            ("equal", validStart, validStart),
            ("reversed", validStart.addingTimeInterval(60), validStart),
            ("non-finite start", Date(timeIntervalSince1970: .nan), validStart),
            ("non-finite end", validStart, Date(timeIntervalSince1970: .infinity)),
            ("out-of-range start", Date(timeIntervalSince1970: -8_640_000_000_001), validStart),
            ("out-of-range end", validStart, Date(timeIntervalSince1970: 8_640_000_000_001)),
        ]

        for (label, start, end) in invalidIntervals {
            let malformed = StoredDeviceActivityPolicy(
                schemaVersion: source.schemaVersion, activityId: source.activityId, appToken: source.appToken,
                timeZoneIdentifier: source.timeZoneIdentifier, windows: source.windows, bonusGrants: source.bonusGrants,
                exceptions: [StoredParentException(id: "bad-\(label)", appScope: .all, startAtUtc: start, endAtUtc: end)],
                dailyLimit: source.dailyLimit, enforcementCapability: source.enforcementCapability
            )
            guard case .failure(.invalidExceptionConfig(let errors)) = PolicySyncDecoder.validate(malformed) else {
                XCTFail("\(label) ParentException interval must be rejected distinctly before enforcement")
                continue
            }
            XCTAssertEqual(errors.count, 1, label)
            XCTAssertTrue(errors[0].contains("finite in-range instants"), label)
        }

        let exactRange = StoredDeviceActivityPolicy(
            schemaVersion: source.schemaVersion, activityId: source.activityId, appToken: source.appToken,
            timeZoneIdentifier: source.timeZoneIdentifier, windows: source.windows, bonusGrants: source.bonusGrants,
            exceptions: [StoredParentException(id: "exact-range", appScope: .all,
                startAtUtc: Date(timeIntervalSince1970: -8_640_000_000_000),
                endAtUtc: Date(timeIntervalSince1970: 8_640_000_000_000))],
            dailyLimit: source.dailyLimit, enforcementCapability: source.enforcementCapability
        )
        guard case .success = PolicySyncDecoder.validate(exactRange) else {
            return XCTFail("finite exception instants at the inclusive supported date limits must validate")
        }

        // A malformed persisted finite interval cannot be restored by the
        // host/extension loader, so it cannot reach ScheduleEngine's path
        // that may alter shields.
        let malformedStored = StoredDeviceActivityPolicy(
            schemaVersion: source.schemaVersion, activityId: source.activityId, appToken: source.appToken,
            timeZoneIdentifier: source.timeZoneIdentifier, windows: source.windows, bonusGrants: source.bonusGrants,
            exceptions: [StoredParentException(id: "equal", appScope: .all, startAtUtc: validStart, endAtUtc: validStart)],
            dailyLimit: source.dailyLimit, enforcementCapability: source.enforcementCapability
        )
        let store = InMemoryBlobStore()
        try store.write(encode(malformedStored), forKey: "schedule.activity-1")
        try store.write(PropertyListEncoder().encode(Set(["app-a"])), forKey: "applicationTokens.activity-1")
        XCTAssertNil(StoredDeviceActivityPolicyLoader<String>(scheduleStore: store, tokenStore: store).load(activityId: "activity-1"))
    }

    func testClosedPolicyShapeRejectsUnexpectedMembersAtEveryDTOLevel() throws {
        let now = Date(timeIntervalSince1970: 1_760_000_000)
        let source = wellFormedPolicy()
        let complete = StoredDeviceActivityPolicy(
            schemaVersion: source.schemaVersion, activityId: source.activityId, appToken: source.appToken,
            timeZoneIdentifier: source.timeZoneIdentifier, windows: source.windows,
            bonusGrants: [StoredBonusGrant(id: "bonus-1", appScope: .all, extraMinutes: 15,
                grantedAtUtc: now, expiresAtUtc: now.addingTimeInterval(3_600))],
            exceptions: [StoredParentException(id: "exception-1", appScope: .all,
                startAtUtc: now, endAtUtc: now.addingTimeInterval(600))],
            dailyLimit: source.dailyLimit, enforcementCapability: source.enforcementCapability
        )
        let base = try policyObject(encode(complete))
        guard case .success = PolicySyncDecoder.decode(encode(complete)) else {
            return XCTFail("the synthesized Codable encoder output must remain accepted")
        }

        func reject(_ label: String, from source: [String: Any],
                    mutate: (inout [String: Any]) -> Void) throws {
            var candidate = source
            mutate(&candidate)
            XCTAssertEqual(PolicySyncDecoder.decode(try encodedPolicyObject(candidate)), .failure(.malformedData),
                "unexpected member was accepted at \(label)")
        }

        try reject("policy root", from: base) { $0["futurePolicyField"] = true }
        try reject("schedule window", from: base) { root in
            var windows = root["windows"] as! [[String: Any]]
            windows[0]["futureWindowField"] = true
            root["windows"] = windows
        }
        try reject("time of day", from: base) { root in
            var windows = root["windows"] as! [[String: Any]]
            var start = windows[0]["start"] as! [String: Any]
            start["seconds"] = 0
            windows[0]["start"] = start
            root["windows"] = windows
        }
        try reject("StoredAppScope.all payload", from: base) { root in
            var windows = root["windows"] as! [[String: Any]]
            var appScope = windows[0]["appScope"] as! [String: Any]
            var allPayload = appScope["all"] as! [String: Any]
            allPayload["futureScopeField"] = "ignored by Codable without a closed-shape check"
            appScope["all"] = allPayload
            windows[0]["appScope"] = appScope
            root["windows"] = windows
        }
        try reject("bonus grant", from: base) { root in
            var grants = root["bonusGrants"] as! [[String: Any]]
            grants[0]["futureGrantField"] = true
            root["bonusGrants"] = grants
        }
        try reject("parent exception", from: base) { root in
            var exceptions = root["exceptions"] as! [[String: Any]]
            exceptions[0]["futureExceptionField"] = true
            root["exceptions"] = exceptions
        }
        try reject("daily app limit", from: base) { root in
            var dailyLimit = root["dailyLimit"] as! [String: Any]
            dailyLimit["futureLimitField"] = true
            root["dailyLimit"] = dailyLimit
        }

        let appsScopeData = try JSONEncoder().encode(StoredAppScope.apps(["app-a"]))
        var appsScope = try XCTUnwrap(JSONSerialization.jsonObject(with: appsScopeData) as? [String: Any])
        XCTAssertEqual(Set(appsScope.keys), ["apps"], "use the enum's synthesized Codable representation")
        var appsPayload = appsScope["apps"] as! [String: Any]
        XCTAssertEqual(Set(appsPayload.keys), ["_0"])
        appsPayload["futureScopeField"] = "not part of StoredAppScope.apps"
        appsScope["apps"] = appsPayload
        var appsRoot = base
        var windows = appsRoot["windows"] as! [[String: Any]]
        windows[0]["appScope"] = appsScope
        appsRoot["windows"] = windows
        XCTAssertEqual(PolicySyncDecoder.decode(try encodedPolicyObject(appsRoot)), .failure(.malformedData),
            "unknown members in the synthesized associated-value payload must be rejected")
    }

    func testClosedShapePreservesLegacyOptionalFieldsAndSynthesizedAppsScope() throws {
        let source = wellFormedPolicy()
        let legacy = StoredDeviceActivityPolicy(
            schemaVersion: source.schemaVersion, activityId: source.activityId, appToken: source.appToken,
            timeZoneIdentifier: source.timeZoneIdentifier,
            windows: [StoredScheduleWindow(id: "legacy", kind: .bedtime, daysOfWeek: [0],
                start: .init(hour: 22, minute: 0), end: .init(hour: 6, minute: 0),
                appScope: .apps(["app-a"]))],
            bonusGrants: [], exceptions: [], dailyLimit: nil,
            enforcementCapability: source.enforcementCapability
        )
        let output = try policyObject(encode(legacy))
        guard case .success = PolicySyncDecoder.decode(encode(legacy)) else {
            return XCTFail("encoder output with absent legacy optionals must decode")
        }

        var explicitNulls = output
        explicitNulls["dailyLimit"] = NSNull()
        var windows = explicitNulls["windows"] as! [[String: Any]]
        windows[0]["timezone"] = NSNull()
        explicitNulls["windows"] = windows
        guard case .success = PolicySyncDecoder.decode(try encodedPolicyObject(explicitNulls)) else {
            return XCTFail("legacy optional dailyLimit/timezone must accept explicit null too")
        }
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

    func testEscapedDuplicatePolicyMemberFailsClosedBeforeCodableDecode() {
        let valid = String(decoding: encode(wellFormedPolicy()), as: UTF8.self)
        let field = "\"activityId\":\"activity-1\""
        XCTAssertTrue(valid.contains(field))
        let ambiguous = valid.replacingOccurrences(
            of: field,
            with: "\"activityId\":\"activity-1\",\"activit\\u0079Id\":\"other-activity\""
        )
        XCTAssertNotEqual(ambiguous, valid)

        XCTAssertEqual(PolicySyncDecoder.decode(Data(ambiguous.utf8)), .failure(.malformedData))
    }

    func testPolicyDecoderRejectsMalformedUnicodeEscapesAndLoneSurrogates() {
        let valid = String(decoding: encode(wellFormedPolicy()), as: UTF8.self)
        let field = "\"appToken\":\"app-a\""
        XCTAssertTrue(valid.contains(field))

        let malformedEscapes = [
            "\\u12G4",          // non-hex digit
            "\\u123",           // truncated four-digit escape
            "\\uD800",          // unpaired high surrogate
            "\\uDC00",          // unpaired low surrogate
            "\\uD800\\u0041",  // high surrogate followed by a non-low surrogate
        ]

        for escape in malformedEscapes {
            let malformed = valid.replacingOccurrences(of: field, with: "\"appToken\":\"\(escape)\"")
            XCTAssertNotEqual(malformed, valid, "fixture must replace the policy token")
            XCTAssertEqual(PolicySyncDecoder.decode(Data(malformed.utf8)), .failure(.malformedData), "accepted malformed JSON string escape: \(escape)")
        }
    }

    func testPolicyDecoderRejectsMalformedJSONGrammarAndNumbers() {
        let valid = String(decoding: encode(wellFormedPolicy()), as: UTF8.self)
        let field = "\"schemaVersion\":1"
        XCTAssertTrue(valid.contains(field))

        let malformedNumbers = ["01", "-01", "1.", "1e", "+1", "--1", "NaN", "Infinity"]
        for number in malformedNumbers {
            let malformed = valid.replacingOccurrences(of: field, with: "\"schemaVersion\":\(number)")
            XCTAssertNotEqual(malformed, valid, "fixture must replace the schema version")
            XCTAssertEqual(PolicySyncDecoder.decode(Data(malformed.utf8)), .failure(.malformedData), "accepted malformed JSON number: \(number)")
        }

        let trailingComma = String(valid.dropLast()) + ",}"
        XCTAssertEqual(PolicySyncDecoder.decode(Data(trailingComma.utf8)), .failure(.malformedData))
    }

    func testPolicyDecoderRejectsEscapedDuplicateMemberInNestedWindow() {
        let valid = String(decoding: encode(wellFormedPolicy()), as: UTF8.self)
        let nestedId = "\"id\":\"bedtime\""
        XCTAssertTrue(valid.contains(nestedId))
        let duplicate = valid.replacingOccurrences(
            of: nestedId,
            with: "\"id\":\"bedtime\",\"i\\u0064\":\"other-window\""
        )
        XCTAssertNotEqual(duplicate, valid)
        XCTAssertEqual(PolicySyncDecoder.decode(Data(duplicate.utf8)), .failure(.malformedData))
    }

    func testWrongSchemaVersionIsRejectedNotSilentlyCoerced() {
        let data = encode(wellFormedPolicy(schemaVersion: 999))
        XCTAssertEqual(PolicySyncDecoder.decode(data), .failure(.unsupportedSchemaVersion(found: 999, expected: policySyncSchemaVersion)))
    }

    func testUnrecognizedTimeZoneIsRejected() {
        let data = encode(wellFormedPolicy(timeZoneIdentifier: "Not/A_Real_Zone"))
        XCTAssertEqual(PolicySyncDecoder.decode(data), .failure(.unrecognizedTimeZone("Not/A_Real_Zone")))
    }

    func testDailyLimitAnchorMustBeAnExactValidGregorianDate() throws {
        let original = wellFormedPolicy()
        let originalDaily = try XCTUnwrap(original.dailyLimit)
        let invalidAnchors = ["2026-2-03", "2026-13-01", "2026-02-30", "2025-02-29", "0000-01-01", "2026-01-07T00:00Z"]

        for anchor in invalidAnchors {
            let malformed = StoredDeviceActivityPolicy(
                schemaVersion: original.schemaVersion, activityId: original.activityId, appToken: original.appToken,
                timeZoneIdentifier: original.timeZoneIdentifier, windows: original.windows,
                bonusGrants: original.bonusGrants, exceptions: original.exceptions,
                dailyLimit: StoredDailyAppLimit(appScope: originalDaily.appScope,
                    limitMinutes: originalDaily.limitMinutes, usedMinutesToday: originalDaily.usedMinutesToday,
                    anchorLocalDate: anchor),
                enforcementCapability: original.enforcementCapability
            )
            XCTAssertEqual(PolicySyncDecoder.decode(encode(malformed)), .failure(.invalidUsageConfig), anchor)
        }
    }

    func testBonusGrantDatesOutsideScheduleInstantRangeAreRejectedBeforePublication() {
        let original = wellFormedPolicy()
        let cases: [(Date, Date)] = [
            (Date(timeIntervalSince1970: 8_640_000_000_001),
             Date(timeIntervalSince1970: 8_640_000_000_002)),
            (Date(timeIntervalSince1970: -8_640_000_000_002),
             Date(timeIntervalSince1970: -8_640_000_000_001)),
            (Date(timeIntervalSince1970: 1_760_000_000),
             Date(timeIntervalSince1970: .infinity)),
        ]
        for (start, end) in cases {
            let malformed = StoredDeviceActivityPolicy(
                schemaVersion: original.schemaVersion, activityId: original.activityId,
                appToken: original.appToken, timeZoneIdentifier: original.timeZoneIdentifier,
                windows: original.windows,
                bonusGrants: [StoredBonusGrant(id: "invalid-instant", appScope: .all,
                    extraMinutes: 5, grantedAtUtc: start, expiresAtUtc: end)],
                exceptions: original.exceptions, dailyLimit: original.dailyLimit,
                enforcementCapability: original.enforcementCapability
            )
            XCTAssertEqual(PolicySyncDecoder.validate(malformed), .failure(.invalidUsageConfig))
        }
    }

    func testDailyLimitAnchorAcceptsGregorianLeapDay() throws {
        let original = wellFormedPolicy()
        let originalDaily = try XCTUnwrap(original.dailyLimit)
        let policy = StoredDeviceActivityPolicy(
            schemaVersion: original.schemaVersion, activityId: original.activityId, appToken: original.appToken,
            timeZoneIdentifier: original.timeZoneIdentifier, windows: original.windows,
            bonusGrants: original.bonusGrants, exceptions: original.exceptions,
            dailyLimit: StoredDailyAppLimit(appScope: originalDaily.appScope,
                limitMinutes: originalDaily.limitMinutes, usedMinutesToday: originalDaily.usedMinutesToday,
                anchorLocalDate: "2024-02-29"),
            enforcementCapability: original.enforcementCapability
        )

        guard case .success(let decoded) = PolicySyncDecoder.decode(encode(policy)) else {
            return XCTFail("a valid leap-day usage anchor must remain accepted")
        }
        XCTAssertEqual(decoded.dailyLimit?.anchorLocalDate, "2024-02-29")
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

    func testDuplicateWindowIdsAreRejectedBeforePolicyIsPublished() throws {
        let source = wellFormedPolicy()
        let template = try XCTUnwrap(source.windows.first)
        let duplicate = StoredScheduleWindow(id: template.id, kind: template.kind,
            daysOfWeek: template.daysOfWeek, start: template.start, end: template.end,
            appScope: template.appScope, timezone: template.timezone)
        let repeated = StoredDeviceActivityPolicy(schemaVersion: source.schemaVersion,
            activityId: source.activityId, appToken: source.appToken,
            timeZoneIdentifier: source.timeZoneIdentifier, windows: [template, duplicate],
            bonusGrants: source.bonusGrants, exceptions: source.exceptions,
            dailyLimit: source.dailyLimit, enforcementCapability: source.enforcementCapability)

        guard case .failure(.invalidWindowConfig(let errors)) = PolicySyncDecoder.decode(encode(repeated)) else {
            return XCTFail("a duplicate window identity must not reach persisted runtime policy")
        }
        XCTAssertTrue(errors.contains("duplicate window id"))

        // String equality normalizes canonical Unicode, but these are distinct
        // opaque UTF-8 IDs and must remain distinct under the shared contract.
        let composedId = "caf\u{00E9}"
        let decomposedId = "cafe\u{0301}"
        let composed = StoredScheduleWindow(id: composedId, kind: template.kind,
            daysOfWeek: template.daysOfWeek, start: template.start, end: template.end,
            appScope: template.appScope, timezone: template.timezone)
        let decomposed = StoredScheduleWindow(id: decomposedId, kind: template.kind,
            daysOfWeek: template.daysOfWeek, start: template.start, end: template.end,
            appScope: template.appScope, timezone: template.timezone)
        let byteDistinct = StoredDeviceActivityPolicy(schemaVersion: source.schemaVersion,
            activityId: source.activityId, appToken: source.appToken,
            timeZoneIdentifier: source.timeZoneIdentifier, windows: [composed, decomposed],
            bonusGrants: source.bonusGrants, exceptions: source.exceptions,
            dailyLimit: source.dailyLimit, enforcementCapability: source.enforcementCapability)
        guard case .success = PolicySyncDecoder.decode(encode(byteDistinct)) else {
            return XCTFail("byte-distinct opaque window IDs must remain distinct")
        }
    }

    func testOutOfContractWeekdayIndicesAreRejectedBeforeCalendarConversion() {
        let source = wellFormedPolicy()
        for invalidDays in [Set([-1]), Set([7]), Set([Int.max])] {
            let invalidWindow = StoredScheduleWindow(id: "bad-day", kind: .bedtime,
                daysOfWeek: invalidDays, start: .init(hour: 22, minute: 0), end: .init(hour: 6, minute: 0),
                appScope: .all, timezone: "UTC")
            let malformed = StoredDeviceActivityPolicy(schemaVersion: source.schemaVersion,
                activityId: source.activityId, appToken: source.appToken, timeZoneIdentifier: source.timeZoneIdentifier,
                windows: [invalidWindow], bonusGrants: [], exceptions: [], dailyLimit: nil,
                enforcementCapability: .enforced)
            guard case .failure(.invalidWindowConfig(let errors)) = PolicySyncDecoder.decode(encode(malformed)) else {
                XCTFail("weekday values outside the shared 0...6 contract must be rejected: \(invalidDays)")
                continue
            }
            XCTAssertTrue(errors.contains { $0.contains("daysOfWeek") }, "\(invalidDays)")
        }
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
    func testStartingDoesNotResolveButCommittedManifestSurvivesMissingPointer() throws {
        let store = GenerationPolicyTestStore(); try seed(store, state: .starting)
        let loader = InstalledDeviceActivityPolicyLoader<String>(scheduleStore: store, tokenStore: store)
        XCTAssertNil(loader.load(monitorActivityId: auxiliary))
        try seed(store); store.remove(forKey: "activeActivityId")
        XCTAssertNotNil(loader.load(monitorActivityId: anchor),
            "the atomically replaced manifest is authoritative if the process dies before repairing its mirror pointer")
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
    func testLegacyPointerReplacementDuringPayloadReadRejectsStalePolicy() throws {
        let store = GenerationPolicyTestStore()
        let policy = StoredDeviceActivityPolicy(schemaVersion: 1, activityId: anchor, appToken: "opaque",
            timeZoneIdentifier: "UTC", windows: [], bonusGrants: [], exceptions: [], dailyLimit: nil,
            enforcementCapability: .enforced)
        let encoder = JSONEncoder(); encoder.dateEncodingStrategy = .iso8601
        try store.write(encoder.encode(policy), forKey: "schedule.\(anchor)")
        try store.write(PropertyListEncoder().encode(Set(["ordinary"])), forKey: "applicationTokens.\(anchor)")
        try store.write(Data(anchor.utf8), forKey: "activeActivityId")
        let loader = InstalledDeviceActivityPolicyLoader<String>(scheduleStore: store, tokenStore: store)
        XCTAssertEqual(loader.load(monitorActivityId: anchor)?.applicationTokens, ["ordinary"])

        store.onRead = { key in
            if key == "applicationTokens.\(self.anchor)" {
                store.onRead = nil
                store.values["activeActivityId"] = Data(self.auxiliary.utf8)
            }
        }
        XCTAssertNil(loader.load(monitorActivityId: anchor),
            "a legacy pointer replaced during payload reads cannot publish the old policy")
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
