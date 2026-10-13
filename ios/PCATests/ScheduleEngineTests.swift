import XCTest
@testable import PCA

/// Ported from backend/test/schedule/engine.test.mjs (PCA-4) to prove this
/// Swift port stays behaviorally aligned with the backend/Android engine
/// it mirrors -- same precedence, same cross-midnight/weekday-rollover/
/// DST handling, same FINDING-006 school-mode intersection semantics.
final class ScheduleEngineTests: XCTestCase {
    private let utc = TimeZone(identifier: "UTC")!
    private let riyadh = TimeZone(identifier: "Asia/Riyadh")!
    func testDailyLimitAppliesOnlyToItsScope() {
        let now = date("2026-01-07T09:00:00Z")
        let excluded = DailyAppLimit(appScope: .apps(["app-b"]), limitMinutes: 30,
            usedMinutesToday: 30, anchorLocalDate: "2026-01-07")
        let included = DailyAppLimit(appScope: .apps(["app-a"]), limitMinutes: 30,
            usedMinutesToday: 30, anchorLocalDate: "2026-01-07")
        XCTAssertEqual(ScheduleEngine.evaluate(input(now: now, dailyLimit: excluded)).kind, .allowed)
        XCTAssertEqual(ScheduleEngine.evaluate(input(now: now, dailyLimit: included)).kind, .blockedLimitReached)
        XCTAssertEqual(ScheduleEngine.evaluate(input(now: now,
            windows: [window(kind: .bedtime)], dailyLimit: excluded)).kind, .blockedBedtime)
    }

    func testEmptyAppTokenFailsClosedInsteadOfMissingAppScopedBlock() {
        let scopedBlock = window(kind: .blockPeriod, appScope: .apps(["app-a"]))
        let result = ScheduleEngine.evaluate(input(
            now: date("2026-01-07T12:00:00Z"), appToken: "", windows: [scopedBlock]
        ))

        XCTAssertEqual(result.kind, .invalidConfig)
        XCTAssertTrue(result.configErrors.contains("app token must be a non-empty string"))
    }

    func testDailyLimitAnchorUsesStableAsciiPolicyLocalDate() {
        let afterMidnightRiyadh = date("2026-01-07T21:30:00Z")
        XCTAssertEqual(ScheduleEngine.localDateString(afterMidnightRiyadh, timeZone: riyadh), "2026-01-08")

        let anchoredToday = DailyAppLimit(appScope: .all, limitMinutes: 30,
            usedMinutesToday: 30, anchorLocalDate: "2026-01-08")
        XCTAssertEqual(ScheduleEngine.evaluate(input(now: afterMidnightRiyadh,
            dailyLimit: anchoredToday)).kind, .blockedLimitReached,
            "the canonical ASCII local-date anchor must match even when the device locale uses localized digits")
    }

    private func window(
        id: String = "w1", kind: ScheduleWindowKind = .blockPeriod,
        days: Set<Int> = [1, 2, 3, 4, 5, 6, 7], start: TimeOfDay = TimeOfDay(hour: 0, minute: 0),
        end: TimeOfDay = TimeOfDay(hour: 23, minute: 59), appScope: AppScope = .all, timeZone: TimeZone? = nil
    ) -> ScheduleWindow {
        ScheduleWindow(id: id, kind: kind, daysOfWeek: days, start: start, end: end, appScope: appScope, timeZone: timeZone ?? riyadh)
    }

    private func input(
        now: Date, timeZone: TimeZone? = nil, appToken: String = "app-a", windows: [ScheduleWindow] = [],
        bonusGrants: [BonusGrant] = [], exceptions: [ParentException] = [], dailyLimit: DailyAppLimit? = nil,
        enforcement: EnforcementCapabilityState = .enforced
    ) -> ScheduleEvaluationInput {
        ScheduleEvaluationInput(
            nowUtc: now, timeZone: timeZone ?? riyadh, appToken: appToken, windows: windows,
            bonusGrants: bonusGrants, exceptions: exceptions, dailyLimit: dailyLimit, enforcementCapability: enforcement
        )
    }

    private func date(_ iso: String) -> Date {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: iso) ?? ISO8601DateFormatter().date(from: iso)!
    }

    func testCrossMidnightBedtimeBlocksBeforeAndAfterMidnightButNotMidday() {
        // Wednesday 2026-01-07, Riyadh (+3).
        let bedtime = window(id: "bedtime", kind: .bedtime, days: [4], start: TimeOfDay(hour: 22, minute: 0), end: TimeOfDay(hour: 6, minute: 0))

        let before = ScheduleEngine.evaluate(input(now: date("2026-01-07T20:00:00Z"), windows: [bedtime])) // 23:00 Riyadh Wed
        XCTAssertEqual(before.kind, .blockedBedtime)

        let after = ScheduleEngine.evaluate(input(now: date("2026-01-07T23:00:00Z"), windows: [bedtime])) // 02:00 Riyadh Thu
        XCTAssertEqual(after.kind, .blockedBedtime)

        let midday = ScheduleEngine.evaluate(input(now: date("2026-01-07T09:00:00Z"), windows: [bedtime])) // 12:00 Riyadh Wed
        XCTAssertEqual(midday.kind, .allowed)
    }

    func testWeekdayRolloverOnlyBlocksCalendarDayAfterMatchingStartDay() {
        // Calendar weekday numbering: 1=Sun...7=Sat. Friday 2026-01-09 = weekday 6.
        let bedtime = window(id: "bedtime", kind: .bedtime, days: [6], start: TimeOfDay(hour: 23, minute: 0), end: TimeOfDay(hour: 7, minute: 0))

        let saturdayEarly = ScheduleEngine.evaluate(input(now: date("2026-01-09T22:00:00Z"), windows: [bedtime])) // 01:00 Riyadh Sat
        XCTAssertEqual(saturdayEarly.kind, .blockedBedtime)

        let sundayEarly = ScheduleEngine.evaluate(input(now: date("2026-01-10T22:00:00Z"), windows: [bedtime])) // 01:00 Riyadh Sun
        XCTAssertEqual(sundayEarly.kind, .allowed)
    }

    func testPrecedenceParentExceptionOverridesActiveBedtime() {
        let bedtime = window(id: "bedtime", kind: .bedtime)
        let exception = ParentException(id: "exc-1", appScope: .all, startAt: date("2026-01-07T11:00:00Z"), endAt: date("2026-01-07T13:00:00Z"))
        let result = ScheduleEngine.evaluate(input(now: date("2026-01-07T12:00:00Z"), windows: [bedtime], exceptions: [exception]))
        XCTAssertEqual(result.kind, .allowedException)
    }

    func testMalformedParentExceptionIntervalsFailClosedBeforeAllowPrecedence() {
        let now = date("2026-01-07T12:00:00Z")
        let bedtime = window(id: "bedtime", kind: .bedtime)
        let validStart = date("2026-01-07T11:00:00Z")
        let validEnd = date("2026-01-07T13:00:00Z")
        let malformed = [
            ParentException(id: "equal", appScope: .all, startAt: validStart, endAt: validStart),
            ParentException(id: "reversed", appScope: .all, startAt: validEnd, endAt: validStart),
            ParentException(id: "non-finite-start", appScope: .all,
                startAt: Date(timeIntervalSince1970: .infinity), endAt: validEnd),
            ParentException(id: "non-finite-end", appScope: .all,
                startAt: validStart, endAt: Date(timeIntervalSince1970: -.infinity)),
            ParentException(id: "out-of-range", appScope: .all,
                startAt: Date(timeIntervalSince1970: 8_640_000_000_001), endAt: validEnd),
        ]

        for exception in malformed {
            let result = ScheduleEngine.evaluate(input(now: now, windows: [bedtime], exceptions: [exception]))
            XCTAssertEqual(result.kind, .invalidConfig, "malformed exception \(exception.id) must not reach allow precedence")
            XCTAssertFalse(result.configErrors.isEmpty)
            XCTAssertFalse(result.kind == .allowedException)
        }
    }

    func testDirectEvaluationRejectsNonFiniteAndOutOfRangeRuntimeInstants() {
        let malformedDates = [
            Date(timeIntervalSince1970: .nan),
            Date(timeIntervalSince1970: .infinity),
            Date(timeIntervalSince1970: 8_640_000_000_001),
        ]
        for date in malformedDates {
            let result = ScheduleEngine.evaluate(input(now: date))
            XCTAssertEqual(result.kind, .invalidConfig)
            XCTAssertTrue(result.configErrors.contains { $0.contains("evaluation time") })
        }
    }

    func testDirectEvaluationRejectsMalformedBonusAndDailyLimitInputs() {
        let now = date("2026-01-07T09:05:00Z")
        let validStart = date("2026-01-07T09:00:00Z")
        let validEnd = date("2026-01-07T10:00:00Z")
        let malformedGrants = [
            BonusGrant(id: "negative", appScope: .all, extraMinutes: -1, grantedAt: validStart, expiresAt: validEnd),
            BonusGrant(id: "reversed", appScope: .all, extraMinutes: 10, grantedAt: validEnd, expiresAt: validStart),
            BonusGrant(id: "non-finite", appScope: .all, extraMinutes: 10,
                grantedAt: Date(timeIntervalSince1970: .infinity), expiresAt: validEnd),
        ]
        for grant in malformedGrants {
            let result = ScheduleEngine.evaluate(input(now: now, bonusGrants: [grant]))
            XCTAssertEqual(result.kind, .invalidConfig, "malformed grant \(grant.id) must not affect an allow decision")
            XCTAssertTrue(result.configErrors.contains { $0.contains("bonus grant \(grant.id)") })
        }

        let malformedLimits = [
            DailyAppLimit(appScope: .all, limitMinutes: -1, usedMinutesToday: 0, anchorLocalDate: "2026-01-07"),
            DailyAppLimit(appScope: .all, limitMinutes: 30, usedMinutesToday: -1, anchorLocalDate: "2026-01-07"),
            DailyAppLimit(appScope: .all, limitMinutes: 30, usedMinutesToday: 30, anchorLocalDate: "2026-02-30"),
        ]
        for limit in malformedLimits {
            let result = ScheduleEngine.evaluate(input(now: now, dailyLimit: limit))
            XCTAssertEqual(result.kind, .invalidConfig, "malformed daily limit must not reset usage or allow")
            XCTAssertTrue(result.configErrors.contains { $0.contains("daily limit") })
        }
    }

    func testSchoolModeIntersectionAcrossTwoOverlappingWindowsWithDifferentAllowScopes() {
        let windowA = window(id: "school-a", kind: .schoolMode, appScope: .apps(["homework-app"]))
        let windowB = window(id: "school-b", kind: .schoolMode, appScope: .all)

        let forward = ScheduleEngine.evaluate(input(now: date("2026-01-07T12:00:00Z"), appToken: "game-app", windows: [windowA, windowB]))
        let reverse = ScheduleEngine.evaluate(input(now: date("2026-01-07T12:00:00Z"), appToken: "game-app", windows: [windowB, windowA]))
        XCTAssertEqual(forward.kind, .blockedSchoolMode)
        XCTAssertEqual(forward.matchedWindowIds, ["school-a"], "only the excluding window is attributed, sorted, never array order")
        XCTAssertEqual(forward, reverse, "decision must be independent of window array order (FINDING-006)")
    }

    func testSchoolModeAllowsAppIncludedByEveryActiveWindow() {
        let windowA = window(id: "school-a", kind: .schoolMode, appScope: .apps(["homework-app", "calculator-app"]))
        let windowB = window(id: "school-b", kind: .schoolMode, appScope: .apps(["calculator-app"]))
        let result = ScheduleEngine.evaluate(input(now: date("2026-01-07T12:00:00Z"), appToken: "calculator-app", windows: [windowA, windowB]))
        XCTAssertEqual(result.kind, .allowed)
    }

    func testBonusGrantExtendsLimitOnlyWhileActive() {
        let dailyLimit = DailyAppLimit(appScope: .all, limitMinutes: 30, usedMinutesToday: 30, anchorLocalDate: "2026-01-07")
        let grant = BonusGrant(id: "bonus-1", appScope: .all, extraMinutes: 15, grantedAt: date("2026-01-07T09:00:00Z"), expiresAt: date("2026-01-07T09:15:00Z"))

        let during = ScheduleEngine.evaluate(input(now: date("2026-01-07T09:05:00Z"), bonusGrants: [grant], dailyLimit: dailyLimit))
        XCTAssertEqual(during.kind, .allowedBonus)

        let after = ScheduleEngine.evaluate(input(now: date("2026-01-07T09:20:00Z"), bonusGrants: [grant], dailyLimit: dailyLimit))
        XCTAssertEqual(after.kind, .blockedLimitReached)
    }

    func testRemainingMinutesUsesFullWidthArithmeticForMaximumInt32PolicyValues() {
        let now = date("2026-01-07T09:05:00Z")
        let dailyLimit = DailyAppLimit(appScope: .all, limitMinutes: Int(Int32.max),
            usedMinutesToday: Int(Int32.max), anchorLocalDate: "2026-01-07")
        let grants = (0..<3).map { index in
            BonusGrant(id: "bonus-\(index)", appScope: .all, extraMinutes: Int(Int32.max),
                grantedAt: date("2026-01-07T09:00:00Z"), expiresAt: date("2026-01-07T10:00:00Z"))
        }

        let result = ScheduleEngine.evaluate(input(now: now, bonusGrants: grants, dailyLimit: dailyLimit))

        XCTAssertEqual(result.kind, .allowedBonus)
        XCTAssertEqual(result.remainingMinutesToday, Int64(Int32.max) * 3)
    }

    func testUnsafeIntPolicyValuesFailClosedLikeBackend() {
        let now = date("2026-01-07T09:05:00Z")
        let dailyLimit = DailyAppLimit(appScope: .all, limitMinutes: Int.max,
            usedMinutesToday: Int.max, anchorLocalDate: "2026-01-07")
        let grant = BonusGrant(id: "bonus-max", appScope: .all, extraMinutes: Int.max,
            grantedAt: date("2026-01-07T09:00:00Z"), expiresAt: date("2026-01-07T10:00:00Z"))

        let result = ScheduleEngine.evaluate(input(now: now, bonusGrants: [grant], dailyLimit: dailyLimit))

        XCTAssertEqual(result.kind, .invalidConfig)
        XCTAssertTrue(result.configErrors.contains { $0.contains("safe integer") })
    }

    func testActiveBonusTotalMustRemainWithinBackendSafeIntegerRange() {
        let now = date("2026-01-07T09:05:00Z")
        let dateStart = date("2026-01-07T09:00:00Z")
        let dateEnd = date("2026-01-07T10:00:00Z")
        let dailyLimit = DailyAppLimit(appScope: .all, limitMinutes: 0, usedMinutesToday: 0, anchorLocalDate: "2026-01-07")
        let grants = [
            BonusGrant(id: "large-a", appScope: .all, extraMinutes: 5_000_000_000_000_000,
                grantedAt: dateStart, expiresAt: dateEnd),
            BonusGrant(id: "large-b", appScope: .all, extraMinutes: 5_000_000_000_000_000,
                grantedAt: dateStart, expiresAt: dateEnd),
        ]

        let result = ScheduleEngine.evaluate(input(now: now, bonusGrants: grants, dailyLimit: dailyLimit))

        XCTAssertEqual(result.kind, .invalidConfig)
        XCTAssertTrue(result.configErrors.contains { $0.contains("active bonus grants") })
    }

    func testEnforcementUnavailableReportsIntendedDecisionInsteadOfBareBlock() {
        let bedtime = window(id: "bedtime", kind: .bedtime)
        let result = ScheduleEngine.evaluate(input(now: date("2026-01-07T12:00:00Z"), windows: [bedtime], enforcement: .unavailable))
        XCTAssertEqual(result.kind, .enforcementUnavailable)
        XCTAssertEqual(result.intendedKind, .blockedBedtime)
    }

    func testEnforcementUnavailableNeverSuppressesAnAllowedVerdict() {
        let result = ScheduleEngine.evaluate(input(now: date("2026-01-07T12:00:00Z"), enforcement: .unavailable))
        XCTAssertEqual(result.kind, .allowed)
    }

    func testInvalidWindowConfigurationIsRejectedWithoutCrashingOrSilentlyAllowing() {
        let malformed = window(start: TimeOfDay(hour: 99, minute: 0))
        let result = ScheduleEngine.evaluate(input(now: date("2026-01-07T12:00:00Z"), windows: [malformed]))
        XCTAssertEqual(result.kind, .invalidConfig)
        XCTAssertFalse(result.configErrors.isEmpty)
    }

    func testDuplicateWindowIdsFailClosedButCanonicalUnicodeAliasesRemainDistinct() {
        let now = date("2026-01-07T12:00:00Z")
        let duplicate = ScheduleEngine.evaluate(input(now: now, windows: [
            window(id: "school-a", kind: .schoolMode, appScope: .all),
            window(id: "school-a", kind: .schoolMode, appScope: .all),
        ]))
        XCTAssertEqual(duplicate.kind, .invalidConfig)
        XCTAssertTrue(duplicate.configErrors.contains("duplicate window id"))

        let composed = "caf\u{00E9}"
        let decomposed = "cafe\u{0301}"
        XCTAssertEqual(composed, decomposed, "Swift String equality is canonically equivalent")
        XCTAssertNotEqual(Data(composed.utf8), Data(decomposed.utf8))
        let distinct = ScheduleEngine.evaluate(input(now: now, windows: [
            window(id: composed, kind: .schoolMode, appScope: .all),
            window(id: decomposed, kind: .schoolMode, appScope: .all),
        ]))
        XCTAssertNotEqual(distinct.kind, .invalidConfig)
        XCTAssertFalse(distinct.configErrors.contains("duplicate window id"))
    }

    func testDSTTransitionShiftsWhichInstantMapsToAFixedLocalBedtimeHour() {
        let newYork = TimeZone(identifier: "America/New_York")!
        let bedtime = window(id: "bedtime", kind: .bedtime, days: [1, 2, 3, 4, 5, 6, 7], start: TimeOfDay(hour: 2, minute: 0), end: TimeOfDay(hour: 3, minute: 0), timeZone: newYork)

        let beforeDst = ScheduleEngine.evaluate(input(now: date("2026-03-01T07:30:00Z"), timeZone: newYork, windows: [bedtime]))
        XCTAssertEqual(beforeDst.kind, .blockedBedtime)

        let afterDst = ScheduleEngine.evaluate(input(now: date("2026-03-15T07:30:00Z"), timeZone: newYork, windows: [bedtime]))
        XCTAssertEqual(afterDst.kind, .allowed)
    }
}
